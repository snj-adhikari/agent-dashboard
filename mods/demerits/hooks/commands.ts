import type { EngineInterface as Engine, On, PluginOptions } from 'claude-code'
import { regenerate } from './files'
import { isHumanPrompt } from './human'
import { refreshStatus } from './reminder'
import { REGISTRY_FILE, START_BY_RANK, fold, sight, type RegistryRow } from './balances'
import { SUPER_FILE } from './chain'
import { REFUSED_FILE, append, clip, identity, ledgerDir, newId, appendLine, read, readLines, ruleFor, stateDir, writeAtomic, type LedgerEvent } from './ledger'

type Memory = { lastTool?: string; lastAssistant?: string }
type Next = (e: any) => any
type Target = { kind: 'self' } | { kind: 'agent'; name: string } | { kind: 'pool' }

const DAY = 86_400_000
const USAGE = {
  demerit: 'Usage: /demerit [@codename|codename|--all] <n> <reason>, e.g. /demerit dirac 3 missed the LGTM image',
  kudos: 'Usage: /kudos [@codename|codename|--all] <n> <reason>, e.g. /kudos dirac 5 clean review',
}

export function parseScore(args: string): { target: Target; n: number; reason: string } | undefined {
  const words = args.trim().split(/\s+/).filter(Boolean)
  let target: Target = { kind: 'self' }
  let n: number | undefined
  while (words.length && (n === undefined || target.kind === 'self')) {
    const w = words[0]
    const num = w.match(/^[+-]?(\d+)$/)
    if (num && n === undefined) n = Number(num[1])
    else if (w === '--all' && target.kind === 'self') target = { kind: 'pool' }
    else if (target.kind === 'self' && (/^@[\w.-]+$/.test(w) || (n === undefined && /^[a-z][\w.-]*$/i.test(w)))) target = { kind: 'agent', name: w.replace(/^@/, '') }
    else if (/^(points?|pts)$/i.test(w) && n !== undefined) {}
    else break
    words.shift()
  }
  if (words[0] && /^(points?|pts)$/i.test(words[0])) words.shift()
  if (words[0] && /^for$/i.test(words[0])) words.shift()
  if (!n) return undefined
  return { target, n, reason: words.join(' ').trim() || 'no reason given' }
}

async function gitOut($: Engine, argv: string[]): Promise<string> {
  try {
    const r = await $.process.run(argv)
    return r.exitCode === 0 ? r.stdout.trim() : ''
  } catch {
    return ''
  }
}

export const describeCall = (e: Record<string, unknown>): string => {
  const arg = ['command', 'file_path', 'path', 'pattern', 'url'].map(k => e[k]).find(v => typeof v === 'string')
  return clip(`${String(e.tool)} ${arg ?? ''}`.trim(), 120) ?? ''
}

async function afterAppend($: Engine, cfg: PluginOptions): Promise<void> {
  await regenerate($, cfg).catch(() => undefined)
  await refreshStatus($, cfg)
}

async function score($: Engine, cfg: PluginOptions, mem: Memory, sign: 1 | -1, args: string): Promise<string> {
  const name = sign < 0 ? 'demerit' : 'kudos'
  const parsed = parseScore(args)
  if (!parsed) return USAGE[name]
  const self = await identity($)
  const session = await $.session.id()
  const [branch, top] = await Promise.all([gitOut($, ['git', 'rev-parse', '--abbrev-ref', 'HEAD']), gitOut($, ['git', 'rev-parse', '--show-toplevel'])])
  const known = [...new Set((await read($, cfg)).map(ev => ev.rule))]
  const { target, n, reason } = parsed
  const agent = target.kind === 'pool' ? 'pool' : target.kind === 'agent' ? target.name : self
  const evidence: LedgerEvent['evidence'] = target.kind === 'self' ? { lastTool: mem.lastTool, lastAssistant: mem.lastAssistant } : { issuedFrom: self }
  const event = await append($, cfg, {
    id: await newId($),
    ts: await $.clock.now(),
    session,
    agent,
    repo: top.split('/').pop() ?? '',
    branch,
    points: sign * n,
    rule: ruleFor(reason, known),
    reason,
    evidence,
    source: 'snj',
    by: 'snj',
    scope: target.kind === 'pool' ? 'pool' : 'agent',
  })
  await afterAppend($, cfg)
  return `${sign < 0 ? 'Demerit' : 'Merit'} ${event.points > 0 ? '+' : ''}${event.points} logged for ${agent}: ${event.rule} (${event.id})`
}

async function undo($: Engine, cfg: PluginOptions, id?: string): Promise<string> {
  const events = await read($, cfg)
  const reversed = new Set(events.flatMap(ev => (ev.reverses ? [ev.reverses] : [])))
  const target = id ? events.find(ev => ev.id === id) : events.findLast(ev => ev.source === 'snj' && !ev.reverses && !reversed.has(ev.id))
  if (!target) return id ? `No event ${id} in the ledger.` : 'Nothing to undo.'
  if (target.reverses) return `${target.id} is a reversal and cannot be undone.`
  if (reversed.has(target.id)) return `${target.id} is already reversed.`
  const event = await append($, cfg, {
    id: await newId($),
    ts: await $.clock.now(),
    session: await $.session.id(),
    agent: target.agent,
    repo: target.repo,
    branch: target.branch,
    points: -target.points,
    rule: target.rule,
    reason: `undo ${target.id}`,
    evidence: { issuedFrom: await identity($) },
    source: 'snj',
    by: 'snj',
    scope: target.scope,
    reverses: target.id,
  })
  await afterAppend($, cfg)
  return `Undid ${target.points > 0 ? '+' : ''}${target.points} for ${target.agent}: ${target.rule} (${event.id} reverses ${target.id})`
}

async function setSuper($: Engine, args: string): Promise<string> {
  const m = args.trim().match(/^super\s+@?([\w.-]+)$/)
  if (!m) return 'Usage: /demerits super @codename'
  const agent = m[1]
  await sight($, agent, 'super')
  await writeAtomic($, `${await stateDir($)}/${SUPER_FILE}`, `${JSON.stringify({ agent })}\n`)
  return `Super agent set to ${agent}.`
}

async function refuse($: Engine, cfg: PluginOptions, command: string, args: string, origin: string): Promise<string> {
  const row = { ts: await $.clock.now(), session: await $.session.id(), agent: await identity($), command, args, origin, reason: 'not typed by the user' }
  await appendLine($, `${await ledgerDir($, cfg)}/${REFUSED_FILE}`, row)
  return `/${command} refused: only a prompt you typed can score points. Logged to ${REFUSED_FILE}.`
}

async function list($: Engine, cfg: PluginOptions): Promise<string> {
  const self = await identity($)
  const now = await $.clock.now()
  const days = Number(cfg.windowDays) || 7
  const events = await read($, cfg)
  const registry = await readLines<RegistryRow>($, `${await stateDir($)}/${REGISTRY_FILE}`)
  const me = fold(events, registry, now, days).agents.find(a => a.agent === self) ?? { balance: START_BY_RANK.sub, week: 0, plus: 0, minus: 0, xp: 0, level: 0 }
  const mine = events.filter(ev => ev.scope === 'agent' && ev.agent === self)
  const recent = mine.filter(ev => ev.ts >= now - days * DAY)
  const change = me.week
  const byRule = new Map<string, number>()
  for (const ev of recent) byRule.set(ev.rule, (byRule.get(ev.rule) ?? 0) + ev.points)
  const top = [...byRule].sort((a, b) => a[1] - b[1]).slice(0, 5).map(([rule, pts]) => `  ${pts > 0 ? '+' : ''}${pts} ${rule}`)
  const last = mine.slice(-10).reverse().map(ev => `  ${new Date(ev.ts).toISOString().slice(0, 16)} ${ev.points > 0 ? '+' : ''}${ev.points} ${ev.rule}: ${ev.reason} (${ev.id})`)
  return [
    `${self}: points ${me.balance}, XP ${me.xp}, level ${me.level}`,
    `${change > 0 ? '+' : ''}${change} in the last ${days} days (Merit: +${me.plus}  Demerit: -${me.minus})`,
    `Top rules\n${top.join('\n') || '  none'}`,
    `Last ${last.length} events\n${last.join('\n') || '  none'}`,
  ].join('\n')
}

export async function runCommand(
  $: Engine,
  cfg: PluginOptions,
  mem: Memory,
  e: { command: string; args: string; origin?: { kind?: string } },
  human?: boolean,
): Promise<string> {
  const args = e.args.trim()
  if (e.command === 'demerits' && !/^super\b/.test(args)) return list($, cfg)
  const text = `/${e.command} ${e.args}`.trim()
  const ok = human ?? (await isHumanPrompt($, { origin: e.origin, text }))
  if (!ok) return refuse($, cfg, e.command, e.args, e.origin?.kind ?? 'unknown')
  if (e.command === 'demerits') return setSuper($, args)
  const undoArgs = e.command === 'demerit' ? args.match(/^undo(?:\s+(\S+))?$/) : null
  if (undoArgs) return undo($, cfg, undoArgs[1])
  return score($, cfg, mem, e.command === 'kudos' ? 1 : -1, e.args)
}

const mem: Memory = {}

export async function commandsSessionStart($: Engine, e: any, next: Next, _cfg: PluginOptions) {
  await $.command.register({ name: 'demerit', description: 'Take points off an agent (demerit)', argumentHint: '[@codename|--all] <n> <reason> | undo [id]' })
  await $.command.register({ name: 'kudos', description: 'Give an agent points for good work (merit)', argumentHint: '[@codename|--all] <n> <reason>' })
  await $.command.register({ name: 'demerits', description: 'Show this agent\'s points, top rules and last events', argumentHint: '[super @codename]' })
  return next(e)
}

export async function commandsToolCall(_$: Engine, e: any, next: Next, _cfg: PluginOptions) {
  const call = e as Record<string, unknown>
  if (!call.agentId) mem.lastTool = describeCall(call)
  return next(e)
}

export async function commandsTurnComplete($: Engine, e: any, next: Next, cfg: PluginOptions) {
  if (!e.agentId) mem.lastAssistant = clip(e.answer)
  const out = await next(e)
  await refreshStatus($, cfg)
  return out
}

export function install(on: On, cfg: PluginOptions): void {
  for (const command of ['demerit', 'kudos', 'demerits']) {
    on('command.run', { command }, async ($, e) => ({ text: await runCommand($, cfg, mem, e) }))
  }
}
