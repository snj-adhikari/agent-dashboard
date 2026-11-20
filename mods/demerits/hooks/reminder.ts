import type { EngineInterface as Engine, On, PluginOptions } from 'claude-code'
import { REGISTRY_FILE, START_BY_RANK, type Folded, type RegistryRow, fold } from './balances'
import { identity, read, readLines, stateDir, writeAtomic, type LedgerEvent } from './ledger'
import { strictRules } from './strict'

const DAY_MS = 86_400_000
const MAX_RULES = 5

const HINTS: Record<string, string> = {
  'commit-without-ask': 'git commit/push ask first',
  'push-without-ask': 'git push ask first',
  tamper: 'ask before touching points files',
  'comment-style': 'ask before writing code files',
  attribution: 'ask before commits and PRs',
  'signature-bypass': 'ask before commits',
}

const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`)

function ago(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000))
  if (mins < 60) return `${Math.max(1, mins)}m ago`
  const hours = Math.floor(mins / 60)
  return hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`
}

export function statusText(folded: Folded, agent: string): string {
  const me = folded.agents.find(a => a.agent === agent)
  return `pts ${me?.balance ?? START_BY_RANK.sub} (+${me?.plus ?? 0} -${me?.minus ?? 0})`
}

async function publish($: Engine, folded: Folded, agent: string): Promise<void> {
  const text = statusText(folded, agent)
  $.ui.status(text)
  const me = folded.agents.find(a => a.agent === agent)
  const dir = `${await stateDir($)}/status`
  const session = await $.session.id()
  const row = { text, balance: me?.balance ?? START_BY_RANK.sub, plus: me?.plus ?? 0, minus: me?.minus ?? 0, agent }
  await $.process.run(['mkdir', '-p', dir])
  await writeAtomic($, `${dir}/${session}.json`, `${JSON.stringify(row)}\n`)
}

export async function refreshStatus($: Engine, cfg: PluginOptions): Promise<void> {
  try {
    const now = await $.clock.now()
    const agent = await identity($)
    const events = await read($, cfg)
    const registry = await readLines<RegistryRow>($, `${await stateDir($)}/${REGISTRY_FILE}`)
    await publish($, fold(events, registry, now, num(cfg.windowDays, 7)), agent)
  } catch {
    return
  }
}

export function reminderText(
  folded: Folded,
  events: readonly LedgerEvent[],
  agent: string,
  strict: readonly string[],
  now: number,
  windowDays: number,
): string {
  const since = now - windowDays * DAY_MS
  const reverses = (e: LedgerEvent): string | undefined => (e as LedgerEvent & { reverses?: string }).reverses
  const reversed = new Set(events.flatMap(e => (reverses(e) ? [reverses(e) as string] : [])))
  const live = events.filter(e => !reverses(e) && !reversed.has(e.id) && e.ts >= since && e.ts <= now)
  const mine = live.filter(e => e.scope === 'agent' && e.agent === agent)
  if (!mine.length && !live.some(e => e.scope === 'pool')) return ''
  const me = folded.agents.find(a => a.agent === agent)
  const lines = [
    `You: ${me?.balance ?? START_BY_RANK.sub} (${signed(me?.week ?? 0)}). Team pool: ${folded.pool.balance} (${signed(folded.pool.week)}). XP ${me?.xp ?? 0}, level ${me?.level ?? 0}.`,
    'Earn points: finish tasks verified, ask before commits, follow the hooks.',
  ]
  const lost = new Map<string, { count: number; points: number; last: number }>()
  for (const e of mine) {
    if (e.points >= 0) continue
    const row = lost.get(e.rule) ?? { count: 0, points: 0, last: 0 }
    lost.set(e.rule, { count: row.count + 1, points: row.points - e.points, last: Math.max(row.last, e.ts) })
  }
  const top = [...lost].sort((a, b) => b[1].points - a[1].points).slice(0, MAX_RULES)
  if (top.length) {
    const parts = top.map(([rule, r]) => (r.count > 1 ? `${rule} ${r.count}x (last ${ago(now - r.last)})` : `${rule} ${r.count}x`))
    lines.push(`Lost points: ${parts.join(', ')}.`)
  }
  if (strict.length) {
    lines.push(`Strict now: ${strict.map(r => `${r} (${HINTS[r] ?? 'ask first'})`).join('; ')}.`)
  }
  return lines.join('\n')
}

const num = (value: unknown, fallback: number): number => {
  const n = Number(value)
  return value !== undefined && value !== '' && Number.isFinite(n) && n > 0 ? n : fallback
}

async function build($: Engine, cfg: PluginOptions): Promise<string> {
  const now = await $.clock.now()
  const windowDays = num(cfg.windowDays, 7)
  const agent = await identity($)
  const events = await read($, cfg)
  const registry = await readLines<RegistryRow>($, `${await stateDir($)}/${REGISTRY_FILE}`)
  const folded = fold(events, registry, now, windowDays)
  await publish($, folded, agent).catch(() => $.ui.status(statusText(folded, agent)))
  const strict = strictRules(events, agent, now, num(cfg.threshold, 3), windowDays)
  return reminderText(folded, events, agent, strict, now, windowDays)
}

export async function reminderSessionStart($: Engine, e: any, next: (e: any) => any, cfg: PluginOptions) {
  try {
    await build($, cfg)
  } catch {
    return next(e)
  }
  return next(e)
}

export async function reminderPromptSubmit($: Engine, e: any, next: (e: any) => any, cfg: PluginOptions) {
  let text = ''
  try {
    text = await build($, cfg)
  } catch {
    return next(e)
  }
  return next(text ? { ...e, context: [...(e.context ?? []), text] } : e)
}

export function install(_on: On, _cfg: PluginOptions): void {}
