import { getDb } from './db'
import { collectState } from './state'
import { sh } from '../utils'

const LOG_INTERVAL_MS = 5 * 60_000
const CLIENT_IDLE_MS = 4 * 60_000

let lastClientAt = 0
let logFailing = false

/** The dashboard only polls while its tab is visible, so recent API traffic means someone is looking. */
export function noteClientSeen(): void {
  lastClientAt = Date.now()
}

function currentBranch(cwd: string): string | undefined {
  const out = sh(`git -C "${cwd}" branch --show-current`).trim()
  return out || undefined
}

export interface Snapshot {
  ts: Date
  repoCount: number
  worktreeCount: number
  tabs: { ref: string; cwd: string; title: string; sessionId?: string; branch?: string }[]
  agents: { pid: string; cmd: string; cwd: string; sessionId?: string; branch?: string }[]
}

export function startHistoryLogging(): void {
  const log = async () => {
    if (Date.now() - lastClientAt > CLIENT_IDLE_MS) return
    try {
      const db = await getDb()
      const state = await collectState()
      const snapshot: Snapshot = {
        ts: new Date(),
        repoCount: state.repos.length,
        worktreeCount: state.repos.reduce((n, r) => n + r.worktrees.length, 0),
        tabs: state.tabs.map((t) => ({ ref: t.ref, cwd: t.cwd, title: t.title, sessionId: t.sessionId, branch: currentBranch(t.cwd) })),
        agents: state.agents.map((a) => ({ pid: a.pid, cmd: a.cmd, cwd: a.cwd, sessionId: a.sessionId, branch: currentBranch(a.cwd) }))
      }
      await db.collection('snapshots').insertOne(snapshot)
      if (logFailing) console.log('history logging recovered')
      logFailing = false
    } catch (e) {
      if (!logFailing) console.error('history logging failed:', (e as Error).message)
      logFailing = true
    }
  }

  setInterval(log, LOG_INTERVAL_MS)
}

export interface TimelinePoint {
  ts: Date
  tabs: number
  agents: number
  worktrees: number
}

export interface SessionSummary {
  ref: string
  cwd: string
  title: string
  sessionId?: string
  branches: string[]
  firstSeen: Date
  lastSeen: Date
}

export interface HistoryData {
  timeline: TimelinePoint[]
  sessions: SessionSummary[]
}

const MAX_POINTS = 300
const CACHE_MS = 30_000
const cache = new Map<number, { at: number; value: HistoryData }>()

/** Keeps the last item of each of `max` equal buckets, so the newest point always survives. */
export function downsample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items
  const step = items.length / max
  return Array.from({ length: max }, (_, i) => items[Math.floor((i + 1) * step) - 1])
}

export function summarise(timeline: Snapshot[]): HistoryData {
  const byRef = new Map<string, SessionSummary & { branchSet: Set<string> }>()
  function touch(ref: string, cwd: string, title: string, sessionId: string | undefined, branch: string | undefined, ts: Date) {
    const existing = byRef.get(ref)
    if (existing) {
      existing.lastSeen = ts
      existing.title = title
      if (branch) existing.branchSet.add(branch)
    } else {
      const branchSet = new Set<string>()
      if (branch) branchSet.add(branch)
      byRef.set(ref, { ref, cwd, title, sessionId, branches: [], branchSet, firstSeen: ts, lastSeen: ts })
    }
  }
  for (const snap of timeline) {
    for (const t of snap.tabs) touch(t.ref, t.cwd, t.title, t.sessionId, t.branch, snap.ts)
    for (const a of snap.agents) touch(`agent_${a.pid}`, a.cwd, a.cmd, a.sessionId, a.branch, snap.ts)
  }

  const sessions = [...byRef.values()]
    .map(({ branchSet, ...rest }) => ({ ...rest, branches: [...branchSet] }))
    .sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime())

  const points = timeline.map((s) => ({ ts: s.ts, tabs: s.tabs.length, agents: s.agents.length, worktrees: s.worktreeCount }))
  return { timeline: downsample(points, MAX_POINTS), sessions }
}

export async function getHistory(sinceMs: number): Promise<HistoryData> {
  const hit = cache.get(sinceMs)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value
  const db = await getDb()
  const since = new Date(Date.now() - sinceMs)
  const snapshots = await db.collection<Snapshot>('snapshots').find({ ts: { $gte: since } }).sort({ ts: 1 }).toArray()
  const value = summarise(snapshots)
  cache.set(sinceMs, { at: Date.now(), value })
  return value
}
