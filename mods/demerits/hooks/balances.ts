import type { EngineInterface as Engine, On, PluginOptions } from 'claude-code'
import { appendLine, readLines, stateDir, type LedgerEvent } from './ledger'

export type Rank = 'sub' | 'main' | 'super'
export type RegistryRow = { agent: string; rank: Rank; start: number; ts: number }
export type Reversal = LedgerEvent & { reverses: string }
export type AgentBalance = { agent: string; rank: Rank; balance: number; week: number; plus: number; minus: number; xp: number; level: number }
export type Folded = { agents: AgentBalance[]; pool: { balance: number; week: number } }

export const REGISTRY_FILE = 'agents.jsonl'
export const POOL_START = 5000
export const XP_PER_LEVEL = 100
export const START_BY_RANK: Record<Rank, number> = { sub: 500, main: 1000, super: 2000 }
const DAY_MS = 86_400_000

export const startOf = (registry: readonly RegistryRow[], agent: string): number | undefined =>
  registry.find(r => r.agent === agent)?.start

const rankOf = (registry: readonly RegistryRow[], agent: string): Rank =>
  registry.findLast(r => r.agent === agent)?.rank ?? 'sub'

export async function sight($: Engine, agent: string, rank: Rank): Promise<RegistryRow> {
  const dir = await stateDir($)
  const path = `${dir}/${REGISTRY_FILE}`
  const rows = await readLines<RegistryRow>($, path)
  const first = rows.find(r => r.agent === agent)
  if (first && rankOf(rows, agent) === rank) return first
  const row = { agent, rank, start: first?.start ?? START_BY_RANK[rank], ts: await $.clock.now() }
  await appendLine($, path, row, [dir])
  return row
}

export const xpOf = (e: LedgerEvent): number => {
  if (e.scope !== 'agent') return 0
  if (e.rule === 'verified-task') return 1
  return (e.source === 'snj' || e.source === 'auto') && e.points > 0 ? e.points : 0
}

export function fold(
  events: readonly LedgerEvent[],
  registry: readonly RegistryRow[],
  now: number,
  windowDays: number,
): Folded {
  const reversed = new Set(events.flatMap(e => (e.reverses ? [e.reverses] : [])))
  const since = now - windowDays * DAY_MS
  const agents = new Map<string, AgentBalance>()
  const pool = { balance: POOL_START, week: 0 }
  const entry = (agent: string): AgentBalance => {
    let a = agents.get(agent)
    if (!a) {
      a = { agent, rank: rankOf(registry, agent), balance: startOf(registry, agent) ?? START_BY_RANK.sub, week: 0, plus: 0, minus: 0, xp: 0, level: 0 }
      agents.set(agent, a)
    }
    return a
  }
  for (const r of registry) entry(r.agent)
  for (const e of events) {
    if (e.reverses || reversed.has(e.id)) continue
    const inWeek = e.ts >= since && e.ts <= now
    pool.balance += e.points
    if (inWeek) pool.week += e.points
    if (e.scope !== 'agent') continue
    const a = entry(e.agent)
    a.balance += e.points
    if (inWeek) {
      a.week += e.points
      if (e.points > 0) a.plus += e.points
      else a.minus -= e.points
    }
    a.xp += xpOf(e)
  }
  for (const a of agents.values()) a.level = Math.floor(a.xp / XP_PER_LEVEL)
  return { agents: [...agents.values()], pool }
}

export function install(_on: On, _cfg: PluginOptions): void {}
