import fs from 'fs'
import os from 'os'
import path from 'path'
import type { Collection } from 'mongodb'
import { getDb } from './db'

export type Rank = 'sub' | 'main' | 'super'
export type DemeritEvent = {
  id: string
  ts: number
  agent: string
  scope: 'agent' | 'pool'
  by: string
  points: number
  rule: string
  reason: string
  source?: string
  rank?: Rank
  biased?: boolean
  reverses?: string
}
export type RegistryRow = { agent: string; rank: Rank; start: number; ts: number }
export type AgentBalance = { agent: string; rank: Rank; balance: number; week: number; xp: number; level: number; biased: boolean }
export type Folded = { agents: AgentBalance[]; pool: { balance: number; week: number } }
export type DemeritsSnapshot = {
  ok: true
  source: 'mongo' | 'vault'
  agents: AgentBalance[]
  pool: { balance: number; week: number }
  events: Pick<DemeritEvent, 'id' | 'ts' | 'agent' | 'scope' | 'by' | 'rank' | 'points' | 'rule' | 'reason'>[]
}

const DEFAULT_LEDGER_DIR = path.join(os.homedir(), '.claude', 'demerits')
const STATE_DIR = path.join(os.homedir(), '.claude', 'demerits-state')
const POOL_START = 5000
const XP_PER_LEVEL = 100
const WINDOW_DAYS = 7
const DAY_MS = 86_400_000
const FEED_SIZE = 50
const BACKFILL_INTERVAL_MS = 5 * 60_000
const START_BY_RANK: Record<Rank, number> = { sub: 500, main: 1000, super: 2000 }

let lastLedgerDir = DEFAULT_LEDGER_DIR

const expandHome = (p: string): string => (p === '~' || p.startsWith('~/') ? os.homedir() + p.slice(1) : p)

function readJsonl<T>(file: string): T[] {
  let text = ''
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return []
  }
  return text.split('\n').flatMap((line) => {
    if (!line.trim()) return []
    try {
      return [JSON.parse(line) as T]
    } catch {
      return []
    }
  })
}

const readLedger = (dir: string): DemeritEvent[] => readJsonl<DemeritEvent>(path.join(dir, 'ledger.jsonl')).filter(isEvent)
const readRegistry = (): RegistryRow[] => readJsonl<RegistryRow>(path.join(STATE_DIR, 'agents.jsonl'))

export function isEvent(e: unknown): e is DemeritEvent {
  const v = e as Partial<DemeritEvent> | null
  return !!v && typeof v.id === 'string' && typeof v.ts === 'number' && typeof v.points === 'number' && typeof v.agent === 'string' && (v.scope === 'agent' || v.scope === 'pool')
}

const rankOf = (registry: readonly RegistryRow[], agent: string): Rank => [...registry].reverse().find((r) => r.agent === agent)?.rank ?? 'sub'
const startOf = (registry: readonly RegistryRow[], agent: string): number | undefined => registry.find((r) => r.agent === agent)?.start

const xpOf = (e: DemeritEvent): number => {
  if (e.scope !== 'agent') return 0
  if (e.rule === 'verified-task') return 1
  return (e.source === 'snj' || e.source === 'auto') && e.points > 0 ? e.points : 0
}

export function fold(events: readonly DemeritEvent[], registry: readonly RegistryRow[], now: number, windowDays = WINDOW_DAYS): Folded {
  const reversed = new Set(events.flatMap((e) => (e.reverses ? [e.reverses] : [])))
  const since = now - windowDays * DAY_MS
  const agents = new Map<string, AgentBalance>()
  const pool = { balance: POOL_START, week: 0 }
  const entry = (agent: string): AgentBalance => {
    let a = agents.get(agent)
    if (!a) {
      a = { agent, rank: rankOf(registry, agent), balance: startOf(registry, agent) ?? START_BY_RANK[rankOf(registry, agent)], week: 0, xp: 0, level: 0, biased: false }
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
    if (inWeek) a.week += e.points
    a.xp += xpOf(e)
    if (e.rule === 'biased-scoring' || e.biased) a.biased = true
  }
  for (const a of agents.values()) a.level = Math.floor(a.xp / XP_PER_LEVEL)
  return { agents: [...agents.values()], pool }
}

export function buildSnapshot(events: readonly DemeritEvent[], registry: readonly RegistryRow[], now: number, source: 'mongo' | 'vault'): DemeritsSnapshot {
  const { agents, pool } = fold(events, registry, now)
  const feed = [...events].sort((a, b) => b.ts - a.ts).slice(0, FEED_SIZE).map(({ id, ts, agent, scope, by, rank, points, rule, reason }) => ({ id, ts, agent, scope, by, rank, points, rule, reason }))
  return { ok: true, source, agents, pool, events: feed }
}

type EventCol = Pick<Collection<DemeritEvent>, 'bulkWrite'>

export async function upsertEvents(col: EventCol, events: readonly DemeritEvent[]): Promise<void> {
  if (!events.length) return
  await col.bulkWrite(events.map((e) => ({ updateOne: { filter: { id: e.id }, update: { $setOnInsert: e }, upsert: true } })))
}

async function recompute(): Promise<void> {
  const db = await getDb()
  const events = await db.collection<DemeritEvent>('demerits_events').find({}, { projection: { _id: 0 } }).toArray()
  const { agents, pool } = fold(events, readRegistry(), Date.now())
  const agentsCol = db.collection('demerits_agents')
  await agentsCol.deleteMany({})
  if (agents.length) await agentsCol.insertMany(agents.map((a) => ({ ...a })))
  await db.collection('demerits_pool').replaceOne({ _id: 'pool' as never }, { _id: 'pool', ...pool, updatedAt: Date.now() }, { upsert: true })
}

export async function ingest(event: unknown, ledgerDir?: string): Promise<{ ok: boolean; stored: boolean; error?: string }> {
  if (!isEvent(event)) return { ok: false, stored: false, error: 'invalid event' }
  if (ledgerDir) lastLedgerDir = expandHome(ledgerDir)
  try {
    await upsertEvents((await getDb()).collection<DemeritEvent>('demerits_events'), [event])
    await recompute()
    return { ok: true, stored: true }
  } catch {
    return { ok: true, stored: false }
  }
}

export async function backfill(): Promise<void> {
  const events = readLedger(lastLedgerDir)
  if (!events.length) return
  await upsertEvents((await getDb()).collection<DemeritEvent>('demerits_events'), events)
  await recompute()
}

export async function snapshot(): Promise<DemeritsSnapshot> {
  try {
    const db = await getDb()
    const events = await db.collection<DemeritEvent>('demerits_events').find({}, { projection: { _id: 0 } }).toArray()
    if (events.length) return buildSnapshot(events, readRegistry(), Date.now(), 'mongo')
  } catch {
    // falls through to the JSONL ledger
  }
  return buildSnapshot(readLedger(lastLedgerDir), readRegistry(), Date.now(), 'vault')
}

let failing = false

export function startDemeritsBackfill(): void {
  const tick = async () => {
    try {
      await backfill()
      if (failing) console.log('demerits backfill recovered')
      failing = false
    } catch (e) {
      if (!failing) console.error('demerits backfill failed:', (e as Error).message)
      failing = true
    }
  }
  void tick()
  setInterval(tick, BACKFILL_INTERVAL_MS)
}
