import { useEffect, useMemo, useState } from 'react'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts'
import { api } from '../api'
import type { HistoryResponse } from '../types'
import { Card, CardPath, CardMeta, Button } from './Card'
import { EmptyState } from './EmptyState'
import { Spinner } from './Spinner'

type HistoryData = Extract<HistoryResponse, { ok: true }>

type Range = 'day' | 'week' | 'month'

const PAGE_SIZE = 50

const PIE_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#ef4444', '#84cc16']
const OTHER_COLOR = '#64748b'

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 mb-5">
      <h2 className="text-sm font-medium text-slate-300">{title}</h2>
      {subtitle && <p className="text-[11px] text-slate-600 mb-2">{subtitle}</p>}
      {children}
    </div>
  )
}

export function HistoryPage() {
  const [range, setRange] = useState<Range>('day')
  const [data, setData] = useState<HistoryData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mongoDown, setMongoDown] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [restartError, setRestartError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [shown, setShown] = useState(PAGE_SIZE)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setMongoDown(false)
    setShown(PAGE_SIZE)
    api
      .history(range)
      .then((j) => {
        if (cancelled) return
        if (j.ok) setData(j)
        else {
          setData(null)
          setError(j.error || 'History is unavailable')
          setMongoDown(!!j.mongoDown)
        }
      })
      .catch((e: Error) => {
        if (cancelled) return
        setData(null)
        setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [range, attempt])

  async function restartMongo() {
    setRestarting(true)
    setRestartError(null)
    try {
      const r = await api.restartMongo()
      if (r.ok) setAttempt((n) => n + 1)
      else setRestartError(r.error || 'restart failed')
    } catch (e) {
      setRestartError((e as Error).message)
    } finally {
      setRestarting(false)
    }
  }

  const timelineData =
    data?.timeline.map((s) => ({
      time: new Date(s.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      tabs: s.tabs,
      agents: s.agents,
      worktrees: s.worktrees
    })) || []

  const repoDistribution = useMemo(() => {
    if (!data) return []
    const counts = new Map<string, { sessions: number; branches: Set<string> }>()
    for (const s of data.sessions) {
      const repo = s.cwd.split('/').filter(Boolean).pop() || s.cwd
      const entry = counts.get(repo) || { sessions: 0, branches: new Set<string>() }
      entry.sessions += 1
      s.branches.forEach((b) => entry.branches.add(b))
      counts.set(repo, entry)
    }
    return [...counts.entries()]
      .map(([name, v]) => ({ name, value: v.sessions, branchCount: v.branches.size }))
      .sort((a, b) => b.value - a.value)
  }, [data])

  const pieData = useMemo(() => {
    const top = repoDistribution.slice(0, PIE_COLORS.length)
    const rest = repoDistribution.slice(PIE_COLORS.length)
    if (!rest.length) return top
    return [...top, { name: `Other (${rest.length} repos)`, value: rest.reduce((n, r) => n + r.value, 0), branchCount: 0 }]
  }, [repoDistribution])

  const sessionsPerDay = useMemo(() => {
    if (!data) return []
    const counts = new Map<string, number>()
    for (const s of data.sessions) {
      const day = new Date(s.firstSeen).toLocaleDateString('en-CA')
      counts.set(day, (counts.get(day) || 0) + 1)
    }
    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, count]) => ({
        day: new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        count
      }))
  }, [data])

  return (
    <div>
      <div className="mb-4 flex gap-2">
        {(['day', 'week', 'month'] as Range[]).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`rounded-md px-3 py-1 text-xs capitalize transition-colors ${
              range === r ? 'bg-brand-dark text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      {!data && loading && <Spinner label="Loading history…" />}

      {error && (
        <div className="rounded-xl border border-red-900/60 bg-red-950/30 p-5 text-sm text-red-200">
          <div className="font-medium">{mongoDown ? 'MongoDB is not running' : 'History is unavailable'}</div>
          <div className="mt-1 break-words font-mono text-xs text-red-300">{error}</div>
          <div className="mt-1 text-xs text-slate-400">
            {mongoDown ? 'History is stored in MongoDB and it is not reachable. Restart it, then history loads again.' : 'Retry in a moment.'}
          </div>
          {restartError && <div className="mt-1 break-words text-xs text-red-300">Restart failed: {restartError}</div>}
          <div className="mt-3 flex gap-2">
            {mongoDown && (
              <Button primary loading={restarting} onClick={restartMongo}>
                Restart MongoDB
              </Button>
            )}
            <Button loading={loading} onClick={() => setAttempt((n) => n + 1)}>
              Retry
            </Button>
          </div>
        </div>
      )}

      {data && (
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <ChartCard title="Activity over time" subtitle="logged every 5 min while the dashboard is open">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={timelineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="time" stroke="#94a3b8" tick={{ fontSize: 10 }} minTickGap={30} />
                <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="tabs" stroke="#22c55e" name="cmux tabs" dot={false} />
                <Line type="monotone" dataKey="agents" stroke="#f59e0b" name="bare agents" dot={false} />
                <Line type="monotone" dataKey="worktrees" stroke="#3b82f6" name="worktrees" dot={false} />
              </LineChart>
            </ResponsiveContainer>
            {!timelineData.length && <p className="text-xs text-slate-500 mt-2">No snapshots yet. Logging runs every 5 minutes while the dashboard is open.</p>}
          </ChartCard>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
            <ChartCard title="Sessions by repo" subtitle="sessions and distinct branches worked, per repo">
              {repoDistribution.length ? (
                <>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>
                        {pieData.map((p, i) => (
                          <Cell key={p.name} fill={i < PIE_COLORS.length ? PIE_COLORS[i] : OTHER_COLOR} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <ul className="mt-1 space-y-0.5 text-[11px] text-slate-400">
                    {repoDistribution.map((r, i) => (
                      <li key={r.name} className="flex items-center gap-1.5">
                        <span
                          className="inline-block h-2 w-2 shrink-0 rounded-sm"
                          style={{ backgroundColor: i < PIE_COLORS.length ? PIE_COLORS[i] : OTHER_COLOR }}
                        />
                        <span className="min-w-0 break-words">
                          {r.name}: {r.value} session(s), {r.branchCount} branch(es)
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-xs text-slate-600">No sessions yet</p>
              )}
            </ChartCard>

            <ChartCard title="New sessions per day" subtitle="by first-seen date">
              {sessionsPerDay.length ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={sessionsPerDay}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="day" stroke="#94a3b8" tick={{ fontSize: 10 }} />
                    <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', fontSize: 12 }} />
                    <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-xs text-slate-600">No sessions yet</p>
              )}
            </ChartCard>
          </div>

          <h2 className="mb-2 text-sm font-medium text-slate-400">Sessions seen in this range</h2>
          <p className="mb-2 text-xs text-slate-600">
            "Switch" only works if the cmux tab is still open — closed sessions are read-only history.
          </p>
          {data.sessions.length ? (
            data.sessions.slice(0, shown).map((s) => (
              <Card key={s.ref}>
                <b className="text-slate-100">{s.ref}</b> — {s.title || '(no title)'}
                <CardPath>{s.cwd}</CardPath>
                <CardMeta>
                  first seen {new Date(s.firstSeen).toLocaleString()} · last seen {new Date(s.lastSeen).toLocaleString()}
                </CardMeta>
                {s.branches.length > 0 && (
                  <CardMeta>
                    branch{s.branches.length > 1 ? 'es' : ''}: {s.branches.join(', ')}
                  </CardMeta>
                )}
                {s.sessionId && (
                  <CardMeta>
                    <code className="rounded bg-slate-950 border border-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                      claude --resume {s.sessionId}
                    </code>
                  </CardMeta>
                )}
              </Card>
            ))
          ) : (
            <EmptyState label="No sessions in this range" />
          )}
          {data.sessions.length > shown && (
            <div className="mt-2 text-center">
              <Button onClick={() => setShown((n) => n + PAGE_SIZE)}>
                Show more ({data.sessions.length - shown} left)
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
