import type { EngineInterface as Engine, On, PluginOptions } from 'claude-code'
import { DAY_MS, parentMap } from './chain'
import { append, newId, read, readLines, stateDir, writeAtomic, type LedgerEvent } from './ledger'

export const SWEEP_FILE = 'bias-sweep.json'
export const BIAS_RULE = 'biased-scoring'
export const BIAS_PENALTY = -5
const GOOD = new Set(['verified-task', 'good-work'])
const WEEK_MS = 7 * DAY_MS

const live = (events: readonly LedgerEvent[]): LedgerEvent[] => {
  const reversed = new Set(events.flatMap(e => (e.reverses ? [e.reverses] : [])))
  return events.filter(e => !e.reverses && !reversed.has(e.id))
}

export function audit(events: readonly LedgerEvent[], giver: string, parents: ReadonlyMap<string, string>, now: number): string[] {
  const all = live(events)
  const recent = (e: LedgerEvent) => e.ts > now - DAY_MS && e.ts <= now
  const given = all.filter(e => e.source === 'agent' && e.by === giver && e.scope === 'agent' && e.agent !== giver && recent(e) && parents.get(e.agent) === giver)
  const findings: string[] = []
  for (const k of given.filter(e => e.points > 0)) {
    const real = all.some(o => o.id !== k.id && o.agent === k.agent && GOOD.has(o.rule) && o.ts > now - WEEK_MS && o.ts <= now)
    if (!real) findings.push(`kudos without matching evidence: ${k.id} to ${k.agent}`)
  }
  for (const sub of new Set(given.map(e => e.agent))) {
    const blocked = all.some(e => e.agent === sub && e.source === 'hook' && e.points < 0 && recent(e))
    const mine = given.filter(e => e.agent === sub)
    if (blocked && mine.some(e => e.points > 0) && !mine.some(e => e.points < 0)) findings.push(`no demerit despite hook blocks: ${sub}`)
  }
  return findings
}

export async function biasCheck($: Engine, cfg: PluginOptions, giver: string): Promise<LedgerEvent | undefined> {
  const [events, parents, now] = await Promise.all([read($, cfg), parentMap($), $.clock.now()])
  const findings = audit(events, giver, parents, now)
  if (!findings.length) return undefined
  if (live(events).some(e => e.rule === BIAS_RULE && e.agent === giver && e.ts > now - DAY_MS && e.ts <= now)) return undefined
  return append($, cfg, {
    id: await newId($),
    ts: now,
    session: await $.session.id(),
    agent: giver,
    repo: '',
    branch: '',
    points: BIAS_PENALTY,
    rule: BIAS_RULE,
    reason: `Biased scoring: ${findings.length} finding${findings.length === 1 ? '' : 's'}`,
    evidence: { findings },
    source: 'auto',
    by: 'auto',
    scope: 'agent',
    biased: true,
  })
}

export async function biasSweep($: Engine, cfg: PluginOptions): Promise<void> {
  const now = await $.clock.now()
  const path = `${await stateDir($)}/${SWEEP_FILE}`
  const last = (await readLines<{ ts: number }>($, path)).at(-1)?.ts ?? 0
  if (now - last < DAY_MS && now >= last) return
  await writeAtomic($, path, JSON.stringify({ ts: now }))
  const givers = new Set(
    live(await read($, cfg)).filter(e => e.source === 'agent' && e.ts > now - DAY_MS).map(e => e.by),
  )
  for (const giver of givers) await biasCheck($, cfg, giver).catch(() => undefined)
}

export async function biasSessionStart<E>($: Engine, e: E, next: (e: E) => unknown, cfg: PluginOptions): Promise<unknown> {
  await biasSweep($, cfg).catch(() => undefined)
  return next(e)
}

export function install(_on: On, _cfg: PluginOptions): void {}
