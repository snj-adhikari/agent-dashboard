import fs from 'fs'
import path from 'path'
import type { RecapResponse, SideSettings } from '../agents'
import type { Snapshot } from '../../history'
import { getDb } from '../../db'
import { relayDir, textHash } from '../relayLog'
import type { Provider } from './registry'

export type RecapSnapshot = Pick<Snapshot, 'ts' | 'tabs' | 'agents' | 'herdr'>

export interface RecapDeps {
  snapshots: (since: Date, until: Date) => Promise<RecapSnapshot[]>
  relayDir: () => string
}

const DAY_MS = 24 * 60 * 60 * 1000
const TOP = 5

/** The keys `approve` writes to the relay log; a `say` of exactly one of these is counted too. */
const DECISION_HASHES = new Set(['1', '2', 'Escape', 'Approved', 'Denied'].map(textHash))

export const recapDeps: RecapDeps = {
  snapshots: async (since, until) => {
    const db = await getDb()
    const projection = { ts: 1, 'tabs.ref': 1, 'tabs.cwd': 1, 'agents.pid': 1, 'agents.cmd': 1, 'agents.cwd': 1, 'herdr.session': 1, 'herdr.paneId': 1, 'herdr.cwd': 1 }
    return db.collection<RecapSnapshot>('snapshots').find({ ts: { $gte: since, $lt: until } }, { projection }).toArray()
  },
  relayDir,
}

/** Monday 00:00 local time of ISO week `YYYY-Www`; week 1 holds 4 January. */
export function weekStart(week: string): Date {
  const [year, w] = week.split('-W').map(Number)
  const jan4 = new Date(year, 0, 4)
  return new Date(year, 0, 4 - ((jan4.getDay() + 6) % 7) + (w - 1) * 7)
}

/** ISO week label of `d` in local time. */
export function isoWeek(d: Date): string {
  const thursday = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() + 3 - ((d.getDay() + 6) % 7)))
  const week = Math.ceil(((thursday.getTime() - Date.UTC(thursday.getUTCFullYear(), 0, 1)) / DAY_MS + 1) / 7)
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

const dayOf = (d: Date): string => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`

/** `<repo>-worktrees/<branch>` counts as `<repo>`. */
export function projectOf(cwd: string): string {
  const parent = path.basename(path.dirname(cwd))
  return parent.endsWith('-worktrees') ? parent.slice(0, -'-worktrees'.length) : path.basename(cwd)
}

const cliOf = (cmd: string): string => path.basename(cmd.trim().split(/\s+/)[0] || 'unknown')

interface RelayLine {
  ts: number
  sha256: string
}

/** Every relay line in the window; symlinks and unparsable lines are skipped. */
function relayLines(dir: string, since: number, until: number): RelayLine[] {
  let files: string[]
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return []
  }
  const out: RelayLine[] = []
  for (const f of files) {
    const file = path.join(dir, f)
    try {
      if (!fs.lstatSync(file).isFile()) continue
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        try {
          const { ts, sha256 } = JSON.parse(line) as Partial<RelayLine>
          if (typeof ts === 'number' && typeof sha256 === 'string' && ts * 1000 >= since && ts * 1000 < until) out.push({ ts, sha256 })
        } catch {}
      }
    } catch {}
  }
  return out
}

const ranked = <K extends string>(counts: Map<string, number>, key: K): ({ count: number } & Record<K, string>)[] =>
  [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ [key]: name, count }) as { count: number } & Record<K, string>)

/**
 * Sessions, CLIs, projects and active days come from history snapshots; approvals and extra active days from the relay log.
 * Finishes and errors have no stored source yet, so they are always 0.
 */
export async function recap(week: string, settings: SideSettings, deps: RecapDeps = recapDeps, now = new Date()): Promise<RecapResponse> {
  const since = week === 'all' ? new Date(0) : weekStart(week)
  const until = week === 'all' ? now : new Date(since.getFullYear(), since.getMonth(), since.getDate() + 7)
  const snaps = await deps.snapshots(since, until).catch(() => [] as RecapSnapshot[])
  const relays = relayLines(deps.relayDir(), since.getTime(), until.getTime())

  const sessions = new Map<string, string>()
  const clis = new Map<string, string>()
  const days = new Set<string>()
  for (const s of snaps) {
    days.add(dayOf(new Date(s.ts)))
    for (const t of s.tabs || []) sessions.set(`tab:${t.ref}`, t.cwd)
    for (const h of s.herdr || []) sessions.set(`herdr:${h.session}:${h.paneId}`, h.cwd)
    for (const a of s.agents || []) {
      sessions.set(`agent:${a.pid}`, a.cwd)
      clis.set(a.pid, cliOf(a.cmd))
    }
  }
  for (const r of relays) days.add(dayOf(new Date(r.ts * 1000)))

  const byCli = new Map<string, number>()
  for (const cli of clis.values()) byCli.set(cli, (byCli.get(cli) || 0) + 1)
  const projects = new Map<string, number>()
  for (const cwd of sessions.values()) if (cwd) projects.set(projectOf(cwd), (projects.get(projectOf(cwd)) || 0) + 1)

  return {
    ok: true,
    week,
    sessions: sessions.size,
    approvals: relays.filter((r) => DECISION_HASHES.has(r.sha256)).length,
    finishes: 0,
    errors: 0,
    byCli: ranked(byCli, 'cli'),
    topProjects: settings.hideProjects ? null : ranked(projects, 'name').slice(0, TOP),
    activeDays: days.size,
  }
}

export const providers: Provider[] = [
  {
    id: 'recap',
    actions: [],
    status: async () => ({ available: true, via: 'local', reason: null }),
    data: async (settings) => {
      const r = await recap(isoWeek(new Date()), settings)
      const row = (id: string, title: string, value: number) => ({ id, title, subtitle: null, value: String(value), url: null, tone: null, group: null, actions: [] })
      return {
        items: [row('sessions', 'Sessions', r.sessions), row('approvals', 'Approvals', r.approvals), row('activeDays', 'Active days', r.activeDays), ...r.byCli.map((c) => row(`cli:${c.cli}`, c.cli, c.count))],
        summary: r.week,
      }
    },
    action: async () => null,
  },
]
