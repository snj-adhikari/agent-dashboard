import path from 'path'
import type { AgentProcess, CmuxTab, HerdrAgent } from '../../types'
import type { HerdrSnapshot } from '../herdr'
import type { LiveSession } from '../hooks/sessions'
import { claimKey, isMainFor, type Claims } from './mainClaims'

export type AgentState = 'working' | 'waiting' | 'done' | 'unknown'
export type AgentHost = 'herdr' | 'herdr-app' | 'cmux' | 'tmux' | 'bare'

export interface Agent {
  id: string
  name: string
  codename: string | null
  colour: string | null
  state: AgentState
  host: AgentHost
  terminalApp: string | null
  scope: string | null
  space: string
  isMain: boolean
  cwd: string
  branch: string | null
  lastLine: string | null
  cli: string | null
  canSend: boolean
  hostApp?: string | null
  pid?: number | null
  sessionId?: string | null
  lastActiveAt?: number | null
  /** Absent means true. */
  canFocus?: boolean
  /** cmux workspace ref hosting a herdr TUI agent. */
  cmuxWorkspace?: string | null
}

export interface ApprovalOption {
  key: string
  label: string
}

export interface Approval {
  id: string
  agentId: string
  tool: string
  command: string
  options: ApprovalOption[]
  receivedAt: number
  screenHash: string
  kind?: ApprovalKind
}

export type ApprovalKind = 'permission' | 'plan' | 'question'
export type ReplyKind = 'reply' | 'ask' | 'summary'

export interface Reply {
  id: string
  agentId: string
  codename: string | null
  text: string
  at: number
  kind?: ReplyKind
  from?: string | null
}

export interface Music {
  player: 'music' | 'spotify'
  playing: boolean
  title: string
  artist: string | null
  durationMs: number | null
  positionMs: number | null
}

export interface UploadResponse {
  ok: true
  uploadId: string
  name: string
  bytes: number
  mime: string
}

export type SideId = 'mail' | 'whatsapp' | 'music' | 'crypto' | 'github' | 'vercel' | 'stripe' | 'n8n' | 'resend' | 'notion' | 'calcom' | 'recap' | 'notes' | 'phone'
export type SideVia = 'cli' | 'applescript' | 'mcp' | 'local' | 'web'
export type SideReason = 'not_installed' | 'signed_out' | 'no_permission' | 'needs_key' | 'unsupported_os' | 'disabled'

export interface SideProvider {
  id: SideId
  available: boolean
  enabled: boolean
  via: SideVia | null
  reason: SideReason | null
}

export interface Holding {
  symbol: string
  amount: number
}

export interface SideSettings {
  enabled: Record<SideId, boolean>
  holdings: Holding[]
  currency: string
  hideProjects: boolean
  phonePush: boolean
}

export interface SideItem {
  id: string
  title: string
  subtitle: string | null
  value: string | null
  url: string | null
  tone: 'ok' | 'warn' | 'error' | null
  group: string | null
  actions: string[]
}

export interface SideDataResponse {
  ok: true
  id: SideId
  updatedAt: number
  items: SideItem[]
  summary: string | null
}

export interface SideActionRequest {
  id: SideId
  action: string
  itemId?: string | null
  text?: string | null
}

export interface RecapResponse {
  ok: true
  week: string
  sessions: number
  approvals: number
  finishes: number
  errors: number
  byCli: { cli: string; count: number }[]
  topProjects: { name: string; count: number }[] | null
  activeDays: number
}

export interface NotesRequest {
  title: string
  transcript: string
}

export type SuperviseIntent = 'send' | 'status' | 'approve' | 'deny' | 'chat' | 'unclear'

export interface SuperviseRequest {
  text: string
  conversationId?: string | null
  cli?: string | null
}

export interface SupervisePending {
  confirmId: string
  summary: string
  expiresAt: number
}

export interface SuperviseResult {
  agentId: string
  ok: boolean
  error: string | null
}

export interface SuperviseResponse {
  ok: true
  conversationId: string
  intent: SuperviseIntent
  text: string
  targets: { agentId: string; name: string }[]
  pending: SupervisePending | null
  results: SuperviseResult[]
}

export interface SuperviseConfirmRequest {
  confirmId: string
  cancel?: boolean
}

export interface StopRequest {
  agentId: string
}

export interface StopResponse {
  ok: true
  relayKey: string
}

export const BARE_SPACE = 'Bare processes'

const STATES: Record<string, AgentState> = { blocked: 'waiting', working: 'working', done: 'done', idle: 'done' }

export const mapState = (status: string): AgentState => STATES[status] || 'unknown'

const cliOf = (agent: string): string | null => (agent ? agent.replace(/-code$/, '') : null)

function fromHerdr(a: HerdrAgent, claims: Claims): Agent {
  const app = a.host === 'herdr-app' || a.session === 'hc'
  const scope = app ? (a.workspaceId ? `hc:${a.workspaceId}` : null) : a.workspaceId ? `herdr:${a.session}:${a.workspaceId}` : null
  return {
    id: `${app ? 'herdr-app' : 'herdr'}:${a.session}:${a.paneId}`,
    name: a.name || a.codename || a.tabTitle || path.basename(a.cwd) || a.paneId,
    codename: a.codename || null,
    colour: a.colour || null,
    state: mapState(a.status),
    host: app ? 'herdr-app' : 'herdr',
    terminalApp: app ? 'herdr-app' : a.cmuxWorkspaceId ? 'cmux' : null,
    scope,
    space: a.display || a.session,
    isMain: isMainFor(claims, scope, a.paneId),
    cwd: a.cwd,
    branch: a.branch || null,
    lastLine: a.title || null,
    cli: cliOf(a.agent),
    canSend: true,
    hostApp: app ? 'Herdr' : a.cmuxWorkspaceId ? 'cmux' : null,
    pid: null,
    sessionId: null,
    lastActiveAt: null,
    cmuxWorkspace: a.cmuxWorkspaceId || null
  }
}

/** Live surface ids and refs per cmux workspace ref; a workspace missing here has no checkable claim. */
export type CmuxSurfaces = Record<string, string[]>

/** A cmux id carries the claimed surface when it is live, so sends and relay keys reach that surface; otherwise the workspace's focused one. */
function fromTab(t: CmuxTab, host: 'cmux' | 'tmux', claims: Claims, surfaces: CmuxSurfaces): Agent {
  const scope = host === 'cmux' && t.id ? `cmux:${t.id}` : null
  const claimed = scope ? claims[claimKey(scope)]?.surface ?? '' : ''
  const isMain = !!claimed && (surfaces[t.ref] || []).includes(claimed)
  return {
    id: host === 'tmux' ? `tmux:${t.ref}:${t.ref}` : isMain ? `cmux:${t.ref}:${claimed}` : `cmux:${t.ref}`,
    name: t.title || path.basename(t.cwd) || t.ref,
    codename: null,
    colour: null,
    state: 'unknown',
    host,
    terminalApp: host,
    scope,
    space: host === 'cmux' ? 'cmux' : 'tmux',
    isMain,
    cwd: t.cwd,
    branch: null,
    lastLine: null,
    cli: null,
    canSend: true,
    hostApp: host === 'cmux' ? 'cmux' : null,
    pid: null,
    sessionId: null,
    lastActiveAt: null
  }
}

function fromProcess(p: AgentProcess, s: LiveSession | undefined, hostApp: string | null): Agent {
  const at = s ? Date.parse(s.at) : NaN
  return {
    id: `bare:${p.pid}:${p.pid}`,
    name: path.basename(p.cwd) || p.cmd,
    codename: null,
    colour: null,
    state: s ? mapState(s.phase) : 'unknown',
    host: 'bare',
    terminalApp: null,
    scope: null,
    space: BARE_SPACE,
    isMain: false,
    cwd: p.cwd,
    branch: s?.branch || null,
    lastLine: null,
    cli: p.cmd || null,
    canSend: false,
    hostApp,
    pid: Number(p.pid),
    sessionId: s?.sessionId || p.sessionId || null,
    lastActiveAt: Number.isNaN(at) ? null : at
  }
}

const HOST_APPS: [RegExp, string][] = [
  [/\/cmux\.app\/|(?:^|\/)cmux$/, 'cmux'],
  [/\/Herdr(?: Core)?\.app\/|(?:^|\/)herdr(?:-core)?$/, 'Herdr'],
  [/\/Terminal\.app\//, 'Terminal'],
  [/\/iTerm2?\.app\//, 'iTerm2'],
  [/\/Ghostty\.app\/|(?:^|\/)ghostty$/, 'Ghostty'],
  [/\/Claude\.app\//, 'Claude']
]

export type ProcTree = Map<string, { ppid: string; comm: string }>

/** `ps -A -o pid=,ppid=,comm=` output; comm keeps its spaces (app bundle paths). */
export function parseProcTree(out: string): ProcTree {
  const tree: ProcTree = new Map()
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/)
    if (m) tree.set(m[1], { ppid: m[2], comm: m[3].trim() })
  }
  return tree
}

/** Nearest ancestor that is a known terminal or desktop app, else null. */
export function hostAppOf(pid: string, tree: ProcTree): string | null {
  const seen = new Set<string>()
  for (let p = tree.get(pid)?.ppid; p && p !== '0' && !seen.has(p); p = tree.get(p)?.ppid) {
    seen.add(p)
    const comm = tree.get(p)?.comm || ''
    const hit = HOST_APPS.find(([re]) => re.test(comm))
    if (hit) return hit[1]
  }
  return null
}

export interface SessionInfo {
  /** Hook-reported Claude Code sessions whose pid is still running. */
  sessions?: LiveSession[]
  tree?: ProcTree
}

/** Bare processes merged with hook sessions by pid; a session with no process entry is listed unless herdr already hosts it. */
function bareAgents(procs: AgentProcess[], { sessions = [], tree = new Map() }: SessionInfo): Agent[] {
  const byPid = new Map(sessions.filter((s) => s.pid && s.cwd).map((s) => [s.pid, s]))
  const out = new Map<string, Agent>()
  for (const p of procs) out.set(p.pid, fromProcess(p, byPid.get(p.pid), hostAppOf(p.pid, tree)))
  for (const [pid, s] of byPid) {
    if (out.has(pid)) continue
    const hostApp = hostAppOf(pid, tree)
    if (hostApp !== 'Herdr') out.set(pid, fromProcess({ pid, cmd: 'claude', cwd: s.cwd, sessionId: s.sessionId }, s, hostApp))
  }
  return [...out.values()]
}

/** Mains first, then by space so groups stay contiguous, then by name. */
export function sortAgents(agents: Agent[]): Agent[] {
  return [...agents].sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.space.localeCompare(b.space) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

/** Bare processes already exclude herdr-owned pids (agentProcesses); cmux tabs hosting a herdr session are dropped as duplicates. */
export function toAgents(snap: HerdrSnapshot, tabs: CmuxTab[], procs: AgentProcess[], claims: Claims, tabHost: 'cmux' | 'tmux' = 'cmux', surfaces: CmuxSurfaces = {}, info: SessionInfo = {}): Agent[] {
  const herdrWorkspaces = new Set(snap.agents.map((a) => a.cmuxWorkspaceId).filter(Boolean))
  return sortAgents([
    ...snap.agents.map((a) => fromHerdr(a, claims)),
    ...tabs.filter((t) => !t.id || !herdrWorkspaces.has(t.id)).map((t) => fromTab(t, tabHost, claims, surfaces)),
    ...bareAgents(procs, info)
  ])
}
