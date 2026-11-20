import type { EngineInterface as Engine, On, PluginOptions } from 'claude-code'
import type { Rank } from './balances'
import { isHumanPrompt } from './human'
import { appendLine, identity, parseLines, readLines, stateDir, type LedgerEvent } from './ledger'

export type GiverRank = Rank | 'snj'
export type ParentRow = { child: string; parent: string; via: string; ts: number }
export type Claim = { surface: string; at: number }
export type HumanRow = { surface: string; ts: number }
export type Verdict = { ok: true } | { ok: false; reason: string }

export type GiveInput = {
  giver: string
  giverRank: GiverRank
  target: string
  targetRank: Rank
  parentOf: (child: string) => string | undefined
  points: number
  now: number
  givenToday: number
  rubricCeiling: number
}

export const PARENTS_FILE = 'parents.jsonl'
export const SUPER_FILE = 'super.json'
export const HUMAN_FILE = 'human-prompts.jsonl'
export const PARENT_TTL_MS = 86_400_000
export const DAY_MS = 86_400_000
export const DAILY_CAP = 20
export const CLAIM_WINDOW_MS = 600_000
export const DEFAULT_DEMERIT = 2

const KUDOS: Record<string, number> = {
  'no-blocks': 5,
  'no-rework': 5,
  'redirections-none': 5,
  'redirections-one': 2,
  'few-prompts': 3,
  'good-work': 18,
  redirections: 5,
}
const HOOK_RULES = new Set(['push-without-ask', 'tamper', 'comment-style', 'attribution', 'signature-bypass'])
const DEMERITS: Record<string, number> = { 'commit-without-ask': 3, 'biased-scoring': 5 }

export function rubricCeiling(rule: string, sign: number): number {
  if (sign > 0) return KUDOS[rule] ?? DEFAULT_DEMERIT
  if (HOOK_RULES.has(rule)) return 1
  return DEMERITS[rule] ?? DEFAULT_DEMERIT
}

export function canGive(i: GiveInput): Verdict {
  const no = (reason: string): Verdict => ({ ok: false, reason })
  if (!Number.isInteger(i.points) || i.points === 0) return no('points must be a non-zero whole number')
  if (i.giver === i.target) return no('cannot give points to yourself')
  if (i.giverRank === 'snj') return { ok: true }
  const size = Math.abs(i.points)
  if (size > i.rubricCeiling) return no(`${size} is above the rubric ceiling of ${i.rubricCeiling}`)
  if (i.givenToday + size > DAILY_CAP) return no(`daily cap of ${DAILY_CAP} per target reached`)
  return { ok: true }
}

export function liveParents(rows: readonly ParentRow[], now: number): Map<string, string> {
  const map = new Map<string, string>()
  for (const r of rows) if (now - r.ts < PARENT_TTL_MS && now >= r.ts) map.set(r.child, r.parent)
  return map
}

export function givenToday(events: readonly LedgerEvent[], giver: string, target: string, now: number): number {
  const reversed = new Set(events.flatMap(e => (e.reverses ? [e.reverses as string] : [])))
  return events
    .filter(e => e.by === giver && e.agent === target && e.scope === 'agent' && e.source === 'agent')
    .filter(e => !e.reverses && !reversed.has(e.id) && e.ts > now - DAY_MS && e.ts <= now)
    .reduce((sum, e) => sum + Math.abs(e.points), 0)
}

export function claimOnHumanPrompt(claims: readonly Claim[], humans: readonly HumanRow[], surfaces: readonly string[]): boolean {
  return claims
    .filter(c => surfaces.includes(c.surface))
    .some(c => humans.some(h => surfaces.includes(h.surface) && h.ts <= c.at && c.at - h.ts <= CLAIM_WINDOW_MS))
}

export function rankFrom(i: {
  ids: readonly string[]
  superAgent?: string
  claimed: boolean
  parents: readonly ParentRow[]
  now: number
}): Rank {
  if (i.superAgent && i.ids.includes(i.superAgent)) return 'super'
  const lead = i.parents.some(p => i.now - p.ts < PARENT_TTL_MS && i.ids.includes(p.parent))
  return i.claimed || lead ? 'main' : 'sub'
}

async function surfacesOf($: Engine): Promise<string[]> {
  const [terminal, herdr, session, pane, cmux] = await Promise.all(
    [$.env.get('HC_TERMINAL_ID'), $.env.get('HERDR_ENV'), $.env.get('HERDR_SESSION'), $.env.get('HERDR_PANE_ID'), $.env.get('CMUX_SURFACE_ID')],
  )
  const out: string[] = []
  if (terminal && herdr !== '1') out.push(`hc:${terminal}`)
  if (herdr === '1' && session && pane) out.push(`${session}:${pane}`)
  if (cmux) out.push(cmux)
  return out
}

async function codenameOf($: Engine, address: string): Promise<string> {
  try {
    const r = await $.process.run(['hc', 'get', address, '--json'])
    const name = (JSON.parse(r.stdout) as { labels?: { codename?: unknown } }).labels?.codename
    return r.exitCode === 0 && typeof name === 'string' && name.trim() ? name.trim() : address
  } catch {
    return address
  }
}

async function readClaims($: Engine): Promise<Claim[]> {
  const dir = `${(await $.env.get('HOME')) ?? ''}/.claude/agent-orchestration/main`
  const r = await $.process.run(['sh', '-c', 'for f in "$1"/*.json; do [ -f "$f" ] && { cat "$f"; echo; }; done', 'sh', dir])
  return parseLines<Claim>(r.stdout)
}

async function readSuper($: Engine, dir: string): Promise<string | undefined> {
  try {
    const path = `${dir}/${SUPER_FILE}`
    if (!(await $.fs.exists(path))) return undefined
    const agent = (JSON.parse((await $.fs.read(path)) as string) as { agent?: unknown }).agent
    return typeof agent === 'string' && agent ? agent.replace(/^@/, '') : undefined
  } catch {
    return undefined
  }
}

export async function resolveRank($: Engine): Promise<Rank> {
  const dir = await stateDir($)
  const now = await $.clock.now()
  const [me, surfaces] = await Promise.all([identity($), surfacesOf($)])
  const ids = [me, ...(await $.env.get('HC_TERMINAL_ID').then(t => (t ? [t] : [])))]
  const [superAgent, claims, humans, parents] = await Promise.all([
    readSuper($, dir),
    readClaims($),
    readLines<HumanRow>($, `${dir}/${HUMAN_FILE}`),
    readLines<ParentRow>($, `${dir}/${PARENTS_FILE}`),
  ])
  return rankFrom({ ids, superAgent, claimed: claimOnHumanPrompt(claims, humans, surfaces), parents, now })
}

export async function parentMap($: Engine): Promise<Map<string, string>> {
  const rows = await readLines<ParentRow>($, `${await stateDir($)}/${PARENTS_FILE}`)
  return liveParents(rows, await $.clock.now())
}

export async function recordParent($: Engine): Promise<void> {
  const lead = (await $.env.get('FACTORY_LEAD'))?.trim()
  if (!lead) return
  const dir = await stateDir($)
  const path = `${dir}/${PARENTS_FILE}`
  const [child, parent, ts] = await Promise.all([identity($), codenameOf($, lead), $.clock.now()])
  if (parent !== lead) await appendLine($, path, { child, parent: lead, via: 'factory-address', ts }, [dir])
  await appendLine($, path, { child, parent, via: 'factory', ts }, [dir])
}

type Next<E> = (e: E) => unknown

export async function chainSessionStart<E>($: Engine, e: E, next: Next<E>, _cfg: PluginOptions): Promise<unknown> {
  await recordParent($).catch(() => undefined)
  return next(e)
}

export async function chainPromptSubmit<E extends { text: string; origin?: { kind?: string } }>(
  $: Engine,
  e: E,
  next: Next<E>,
  _cfg: PluginOptions,
): Promise<unknown> {
  await markHuman($, e).catch(() => undefined)
  return next(e)
}

async function markHuman($: Engine, e: { text: string; origin?: { kind?: string } }): Promise<void> {
  const [surface] = await surfacesOf($)
  if (!surface || !(await isHumanPrompt($, e))) return
  const dir = await stateDir($)
  await appendLine($, `${dir}/${HUMAN_FILE}`, { surface, ts: await $.clock.now() }, [dir])
}

export function install(_on: On, _cfg: PluginOptions): void {}
