import { execFile } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { isUnder, normPath } from '../utils'
import type { HerdrAgent, Repo } from '../types'

export const SESSION_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/
export const TARGET_RE = /^w\d+:p\d+$|^[a-z][a-z0-9_-]{0,31}$/
const TICKET_RE = /[A-Z][A-Z0-9]+-\d+/
const CACHE_MS = 3000
const HERDR_DIR = path.join(os.homedir(), '.config', 'herdr')
const PROJECTS_PATH = path.join(HERDR_DIR, 'projects.json')
const SIDEBAR_PATH = path.join(HERDR_DIR, 'cmux-sidebar.json')
export const SNJ_TERM = path.join(os.homedir(), '.claude', 'hooks', 'snj', 'snj-term')
const GREY = '#64748b'
const STATUS_RANK: Record<string, number> = { blocked: 0, working: 1, done: 2, idle: 3 }

export class HerdrError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
  }
}

/** herdr reports server errors as `{"error":{"code","message"}}` on stderr. */
export function parseHerdrError(stderr: string): { code: string; message: string } | null {
  try {
    const err = JSON.parse(stderr.trim()).error
    return err && typeof err.code === 'string' ? { code: err.code, message: String(err.message || err.code) } : null
  } catch {
    return null
  }
}

const execFileAsync = promisify(execFile)
const INHERITED_HERDR_VARS = ['HERDR_SOCKET_PATH', 'HERDR_PANE_ID', 'HERDR_TAB_ID', 'HERDR_WORKSPACE_ID', 'HERDR_ENV', 'HERDR_SESSION']

/** Pane variables inherited by a server started inside herdr would otherwise override HERDR_SESSION. */
export function herdrEnv(base: NodeJS.ProcessEnv, session: string | null): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(base).filter(([k]) => !INHERITED_HERDR_VARS.includes(k)))
  return session ? { ...env, HERDR_SESSION: session } : env
}

async function herdr(session: string | null, args: string[]): Promise<string> {
  try {
    return (await execFileAsync('herdr', args, { encoding: 'utf8', timeout: 5000, env: herdrEnv(process.env, session) })).stdout
  } catch (e) {
    const err = e as { code?: string; stderr?: string; message?: string }
    if (err.code === 'ENOENT') throw new HerdrError('herdr is not installed', 'not_installed')
    const parsed = parseHerdrError(String(err.stderr || ''))
    throw new HerdrError(parsed?.message || String(err.stderr || err.message || 'herdr failed').trim(), parsed?.code || 'failed')
  }
}

/** `herdr session list` is a text table: name, status, directory, socket. */
export function parseSessionList(text: string): string[] {
  return text
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([name, status]) => status === 'running' && SESSION_RE.test(name))
    .map(([name]) => name)
}

type RawAgent = Omit<HerdrAgent, 'session'>

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** An error payload (e.g. server_not_running) or anything unparseable yields no agents. */
export function parseAgentList(json: string): RawAgent[] {
  let agents: unknown
  try {
    agents = JSON.parse(json)?.result?.agents
  } catch {
    return []
  }
  if (!Array.isArray(agents)) return []
  return agents
    .filter((a) => a && typeof a === 'object' && str(a.pane_id))
    .map((a) => ({
      paneId: str(a.pane_id),
      workspaceId: str(a.workspace_id),
      tabId: str(a.tab_id),
      agent: str(a.agent),
      status: str(a.agent_status) || 'unknown',
      title: str(a.terminal_title_stripped) || str(a.terminal_title),
      cwd: str(a.foreground_cwd) || str(a.cwd),
      name: str(a.name) || undefined,
      label: str(a.display_agent) || undefined,
      codename: codenameOf(str(a?.tokens?.codename) || str(a.display_agent), str(a.name))
    }))
}

/** Reported metadata wins; else the agent name minus its `<key>-` or `sub-` prefix. */
export function codenameOf(reported: string, name: string): string | undefined {
  if (/^[a-z][a-z0-9_-]{0,31}$/.test(reported)) return reported
  return name.match(/^(?:[a-z][a-z0-9]*-\d+|sub)-([a-z][a-z0-9_]*)$/)?.[1]
}

type Palette = Record<string, { colour?: string }>

export function colourOf(codename: string | undefined, palette: Palette): string {
  const colour = codename ? palette[codename[0]]?.colour : undefined
  return colour && /^#[0-9a-fA-F]{6}$/.test(colour) ? colour : GREY
}

export function parseTabList(json: string): Map<string, string> {
  try {
    const tabs = JSON.parse(json)?.result?.tabs
    return new Map(Array.isArray(tabs) ? tabs.map((t) => [str(t?.tab_id), str(t?.label)]) : [])
  } catch {
    return new Map()
  }
}

export function ticketOf(...parts: (string | undefined)[]): string | undefined {
  for (const p of parts) {
    const m = p?.match(TICKET_RE)
    if (m) return m[0]
  }
  return undefined
}

interface Scope {
  display?: string
  workspaceId?: string
}

function projects(): { scopes: Record<string, Scope>; codenames: Palette } {
  try {
    const j = JSON.parse(fs.readFileSync(PROJECTS_PATH, 'utf8'))
    return { scopes: j.scopes || {}, codenames: j.codenames || {} }
  } catch {
    return { scopes: {}, codenames: {} }
  }
}

const scopes = (): Record<string, Scope> => projects().scopes

export interface HerdrSnapshot {
  at: number
  /** False until the first refresh, and whenever a running server could not be listed. */
  ok: boolean
  sessions: string[]
  agents: HerdrAgent[]
}

let current: HerdrSnapshot = { at: 0, ok: false, sessions: [], agents: [] }
let refreshing: Promise<HerdrSnapshot> | null = null

async function sessionAgents(session: string, scope: Scope, codenames: Palette): Promise<HerdrAgent[]> {
  const [raw, tabs] = await Promise.all([
    herdr(session, ['agent', 'list']).then(parseAgentList),
    herdr(session, ['tab', 'list']).then(parseTabList, () => new Map<string, string>())
  ])
  return raw.map((a) => ({
    ...a,
    session,
    display: scope.display,
    tabTitle: tabs.get(a.tabId) || undefined,
    colour: colourOf(a.codename, codenames),
    cmuxWorkspaceId: scope.workspaceId
  }))
}

async function loadSnapshot(): Promise<HerdrSnapshot> {
  let sessions: string[]
  try {
    sessions = parseSessionList(await herdr(null, ['session', 'list']))
  } catch (e) {
    const missing = e instanceof HerdrError && e.code === 'not_installed'
    return { at: Date.now(), ok: missing, sessions: missing ? [] : current.sessions, agents: missing ? [] : current.agents }
  }
  const { scopes: scopeMap, codenames } = projects()
  const results = await Promise.allSettled(sessions.map((s) => sessionAgents(s, scopeMap[s] || {}, codenames)))
  return {
    at: Date.now(),
    ok: results.every((r) => r.status === 'fulfilled'),
    sessions,
    agents: results.flatMap((r, i) => (r.status === 'fulfilled' ? r.value : current.agents.filter((a) => a.session === sessions[i])))
  }
}

/** Refreshes in the background; concurrent callers share one refresh. */
export function refreshHerdr(): Promise<HerdrSnapshot> {
  refreshing ??= loadSnapshot()
    .then((snap) => (current = snap))
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

/** The last snapshot, never blocking; a stale one triggers a background refresh. */
export function herdrSnapshot(): HerdrSnapshot {
  if (Date.now() - current.at >= CACHE_MS) void refreshHerdr().catch(() => {})
  return current
}

export function herdrSessions(): string[] {
  return herdrSnapshot().sessions
}

/** Every agent in every running session, without worktree details. */
export function herdrAgents(): HerdrAgent[] {
  return herdrSnapshot().agents
}

/** Joins each agent to the deepest worktree containing its cwd, and derives the ticket from tab, name or branch. */
export function withWorktrees(agents: HerdrAgent[], repos: Repo[]): HerdrAgent[] {
  const worktrees = repos.flatMap((r) => r.worktrees).map((wt) => ({ wt, root: normPath(wt.path) }))
  return agents.map((a) => {
    const cwd = normPath(a.cwd)
    const match = worktrees.filter(({ root }) => isUnder(cwd, root)).sort((x, y) => y.root.length - x.root.length)[0]?.wt
    return {
      ...a,
      worktree: match?.path,
      branch: match?.branch,
      changedFiles: match?.changedFiles,
      ticket: ticketOf(a.tabTitle, a.name, match?.branch?.toUpperCase())
    }
  })
}

function checkTarget(session: string, target: string): void {
  if (!SESSION_RE.test(session) || !TARGET_RE.test(target)) throw new HerdrError('invalid herdr session or target', 'invalid')
}

export async function readHerdrAgent(session: string, target: string, lines = 200): Promise<string> {
  checkTarget(session, target)
  const n = Math.min(Math.max(Math.floor(lines) || 200, 1), 1000)
  return herdr(session, ['agent', 'read', target, '--source', 'recent', '--lines', String(n)])
}

/** Throws HerdrError with code `agent_blocked` when the agent is waiting on an approval or question. */
export async function promptHerdrAgent(session: string, target: string, text: string): Promise<void> {
  checkTarget(session, target)
  await herdr(session, ['agent', 'prompt', target, text.startsWith('-') ? ` ${text}` : text])
}

export async function sendHerdrKeys(session: string, target: string, ...keys: string[]): Promise<void> {
  checkTarget(session, target)
  await herdr(session, ['agent', 'send-keys', target, ...keys])
}

const AGENT_NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/

/** Opens or focuses the agent's cmux attach tab; snj-term reuses an existing one. */
export async function focusHerdrAgent(session: string, name: string): Promise<unknown> {
  if (!SESSION_RE.test(session) || !AGENT_NAME_RE.test(name)) throw new HerdrError('invalid herdr session or agent name', 'invalid')
  try {
    const { stdout } = await execFileAsync(SNJ_TERM, ['attach', session, name], { timeout: 30_000 })
    return JSON.parse(stdout)
  } catch (e) {
    let reason = ''
    try {
      reason = JSON.parse(String((e as { stdout?: string }).stdout)).error
    } catch {}
    throw new HerdrError(reason || (e as Error).message, 'failed')
  }
}

export const herdrRef = (session: string, paneId: string): string => `herdr:${session}:${paneId}`

export interface TicketOutput {
  mode?: string
  session?: string
  items?: { pane?: string; workspace?: string }[]
}

/** The ref a `snj-term ticket` result opened: a herdr pane ref, or the cmux workspace of its own fallback. */
export function ticketRef(out: TicketOutput): string | undefined {
  const item = out.items?.[0]
  if (out.mode === 'herdr' && out.session && item?.pane) return herdrRef(out.session, item.pane)
  return item?.workspace
}

export function parseHerdrRef(ref: string): { session: string; paneId: string } | null {
  const m = ref.match(/^herdr:([^:]+):(w\d+:p\d+)$/)
  return m && SESSION_RE.test(m[1]) ? { session: m[1], paneId: m[2] } : null
}

const isController = (a: HerdrAgent): boolean => a.name === `main-${a.session}`

/** Agents that just moved into blocked or done; first sightings and the controller never alert. */
export function statusAlerts(prev: Map<string, string>, agents: HerdrAgent[]): { alerts: HerdrAgent[]; next: Map<string, string> } {
  const next = new Map(agents.map((a) => [`${a.session}/${a.paneId}`, a.status]))
  const alerts = agents.filter((a) => {
    const before = prev.get(`${a.session}/${a.paneId}`)
    return before !== undefined && before !== a.status && (a.status === 'blocked' || a.status === 'done') && !isController(a)
  })
  return { alerts, next }
}

const lastLine = (s: string): string => s.split('\n').map((l) => l.trim()).filter(Boolean).pop() || ''

export function alertMessage(a: HerdrAgent): string {
  return `[monitor] ${[a.ticket || a.tabTitle || a.paneId, a.codename].filter(Boolean).join(' ')}: ${a.status} — ${lastLine(a.title)}`
}

const ignore = (): void => {}
const SIDE_EFFECT_TIMEOUT = { timeout: 30_000 }

function writeSidebar(agents: HerdrAgent[], sessions: string[]): void {
  const byStatus = (a: HerdrAgent, b: HerdrAgent): number => (STATUS_RANK[a.status] ?? 4) - (STATUS_RANK[b.status] ?? 4)
  const scopeMap = scopes()
  const out = {
    updatedAt: new Date().toISOString(),
    scopes: Object.fromEntries(
      sessions.map((session) => [
        session,
        {
          display: scopeMap[session]?.display || session,
          cmuxWorkspaceId: scopeMap[session]?.workspaceId,
          agents: agents
            .filter((a) => a.session === session && !isController(a))
            .sort(byStatus)
            .map((a) => ({ tab: a.tabTitle, codename: a.codename, colour: a.colour, ticket: a.ticket, status: a.status, title: a.title, worktree: a.worktree, changedFiles: a.changedFiles }))
        }
      ])
    )
  }
  fs.mkdirSync(HERDR_DIR, { recursive: true })
  const tmp = `${SIDEBAR_PATH}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2))
  fs.renameSync(tmp, SIDEBAR_PATH)
}

let lastStatus = new Map<string, string>()

/** Per poll: cmux pills, blocked/done alerts to the controller and cmux, and the sidebar data file. */
export function herdrSideEffects(agents: HerdrAgent[], sessions: string[]): void {
  for (const session of sessions) execFile(SNJ_TERM, ['pill', session], SIDE_EFFECT_TIMEOUT, ignore)
  const { alerts, next } = statusAlerts(lastStatus, agents)
  lastStatus = next
  for (const a of alerts) {
    const msg = alertMessage(a)
    execFile(SNJ_TERM, ['send', a.session, `main-${a.session}`, msg], SIDE_EFFECT_TIMEOUT, ignore)
    const where = a.cmuxWorkspaceId ? ['--workspace', a.cmuxWorkspaceId] : []
    execFile('cmux', ['notify', '--title', `herdr ${a.display || a.session}`, '--body', msg.replace(/^\[monitor\] /, ''), ...where], SIDE_EFFECT_TIMEOUT, ignore)
  }
  try {
    writeSidebar(agents, sessions)
  } catch {}
}
