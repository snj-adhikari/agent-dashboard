import { useEffect, useMemo, useState } from 'react'
import {
  BarChart,
  ComposedChart,
  Bar,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer
} from 'recharts'
import { api } from '../api'
import type { LearningGran, LearningResponse, LearningSource, LearntKind } from '../types'
import { Button } from './Card'
import { EmptyState } from './EmptyState'
import { Spinner } from './Spinner'
import { ChartCard, PIE_COLORS } from './charts'

type LearningData = Extract<LearningResponse, { ok: true }>

const TOOLTIP_STYLE = { backgroundColor: '#1e293b', border: '1px solid #334155', fontSize: 12 }

const AUDIENCE_TITLE: Record<string, string> = {
  'slack-dm': 'Slack DM',
  'slack-channel': 'Slack channel',
  jira: 'Jira',
  confluence: 'Confluence',
  'github-pr': 'GitHub PR'
}

const KIND_LABELS: Record<LearntKind, string> = {
  feature: 'Style features',
  structure: 'Structure',
  token: 'Tokens',
  nepali: 'Nepali phrases',
  perspective: 'Perspective notes',
  'feedback-rule': 'Feedback rules',
  'edit-rule': 'Edit rules'
}

const SOURCE_LABELS: Record<LearningSource, string> = {
  slack: 'Slack',
  jira: 'Jira',
  confluence: 'Confluence',
  github: 'GitHub',
  prompts: 'Prompts',
  notes: 'Notes',
  observed: 'Observed',
  'edits-feedback': 'Edits and feedback'
}

function Donut({ data }: { data: { name: string; value: number }[] }) {
  if (!data.length) return <p className="text-xs text-slate-600">Nothing learnt yet</p>
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>
          {data.map((d, i) => (
            <Cell key={d.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: '#e2e8f0' }} />
        <Legend wrapperStyle={{ fontSize: 11 }} formatter={(name) => `${name} (${data.find((d) => d.name === name)?.value})`} />
      </PieChart>
    </ResponsiveContainer>
  )
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-200">{children}</dd>
    </div>
  )
}

export function LearningPage() {
  const [gran, setGran] = useState<LearningGran>('day')
  const [data, setData] = useState<LearningData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .learning(gran)
      .then((j) => {
        if (cancelled) return
        if (j.ok) setData(j)
        else {
          setData(null)
          setError(j.error || 'Learning insights are unavailable')
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
  }, [gran, attempt])

  async function refresh() {
    setRefreshing(true)
    try {
      await api.learningRefresh()
    } catch {
      // the reload below surfaces any failure
    } finally {
      setRefreshing(false)
      setAttempt((n) => n + 1)
    }
  }

  const chart = useMemo(() => {
    if (!data) return { rows: [], markers: [] as { key: string; kind: string }[] }
    const rows = data.history.map((b) => ({
      key: b.key,
      human: b.learnt.human,
      ai: b.learnt.ai,
      unsure: b.learnt.unsure,
      ...b.captures,
      cumulativeHuman: b.cumulativeHuman
    }))
    const starts = data.history.map((b) => ({ key: b.key, start: b.start }))
    const seen = new Set<string>()
    const markers: { key: string; kind: string }[] = []
    for (const run of data.current.runs) {
      const bucket = [...starts].reverse().find((s) => s.start <= run.date)
      if (!bucket || seen.has(`${bucket.key}:${run.kind}`)) continue
      seen.add(`${bucket.key}:${run.kind}`)
      markers.push({ key: bucket.key, kind: run.kind })
    }
    return { rows, markers }
  }, [data])

  const donuts = useMemo(() => {
    if (!data) return { learnt: [], sources: [] }
    const { learnt, sources } = data.current
    return {
      learnt: (Object.keys(KIND_LABELS) as LearntKind[]).filter((k) => learnt[k] > 0).map((k) => ({ name: KIND_LABELS[k], value: learnt[k] })),
      sources: (Object.keys(SOURCE_LABELS) as LearningSource[]).filter((k) => sources[k] > 0).map((k) => ({ name: SOURCE_LABELS[k], value: sources[k] }))
    }
  }, [data])

  const current = data?.current

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        {(['day', 'week', 'month'] as LearningGran[]).map((r) => (
          <button
            key={r}
            onClick={() => setGran(r)}
            aria-pressed={gran === r}
            className={`rounded-md px-3 py-1 text-xs capitalize transition-colors ${
              gran === r ? 'bg-brand-dark text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {r}
          </button>
        ))}
        <div className="ml-auto">
          <Button loading={refreshing} onClick={refresh}>
            Refresh
          </Button>
        </div>
      </div>

      {!data && loading && <Spinner label="Loading learning insights…" />}

      {error && (
        <div className="rounded-xl border border-red-900/60 bg-red-950/30 p-5 text-sm text-red-200">
          <div className="font-medium">Learning insights are unavailable</div>
          <div className="mt-1 break-words font-mono text-xs text-red-300">{error}</div>
          <div className="mt-3">
            <Button loading={loading} onClick={() => setAttempt((n) => n + 1)}>
              Retry
            </Button>
          </div>
        </div>
      )}

      {data && current && (
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          {data.mongoDown && (
            <div className="mb-5 rounded-xl border border-amber-900/60 bg-amber-950/30 p-4 text-sm text-amber-200">
              Persistent history needs MongoDB; showing history derived from the folder
            </div>
          )}

          {current.empty ? (
            <EmptyState
              label={
                <>
                  Nothing learnt yet. Run <code className="text-slate-400">{current.hint ?? '/more-like-you learn'}</code> to start.
                </>
              }
            />
          ) : (
            <>
              <ChartCard title="Learnt over time" subtitle="human, AI and unsure paragraphs from your own writing; line is cumulative human">
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={chart.rows} margin={{ top: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="key" stroke="#94a3b8" tick={{ fontSize: 10 }} minTickGap={30} />
                    <YAxis yAxisId="left" stroke="#94a3b8" tick={{ fontSize: 10 }} allowDecimals={false} label={{ value: 'paragraphs', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 10 }} />
                    <YAxis yAxisId="right" orientation="right" stroke="#94a3b8" tick={{ fontSize: 10 }} allowDecimals={false} label={{ value: 'cumulative human', angle: 90, position: 'insideRight', fill: '#94a3b8', fontSize: 10 }} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: '#e2e8f0' }} labelStyle={{ color: '#e2e8f0' }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="left" stackId="learnt" dataKey="human" name="human" fill="#22c55e" />
                    <Bar yAxisId="left" stackId="learnt" dataKey="ai" name="AI" fill="#3b82f6" />
                    <Bar yAxisId="left" stackId="learnt" dataKey="unsure" name="unsure" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    <Line yAxisId="right" type="monotone" dataKey="cumulativeHuman" name="cumulative human" stroke="#e879f9" strokeWidth={2} dot={false} />
                    {chart.markers.map((m) => (
                      <ReferenceLine
                        key={`${m.key}:${m.kind}`}
                        yAxisId="left"
                        x={m.key}
                        stroke="#94a3b8"
                        strokeDasharray="4 4"
                        label={{ value: m.kind, fill: '#cbd5e1', fontSize: 10, position: 'top' }}
                      />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
                {!chart.rows.length && <p className="mt-2 text-xs text-slate-500">No history yet.</p>}
              </ChartCard>

              <ChartCard title="Captured over time" subtitle="rows captured per bucket: pulls, observed, prompts, feedback and edits">
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={chart.rows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="key" stroke="#94a3b8" tick={{ fontSize: 10 }} minTickGap={30} />
                    <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: '#e2e8f0' }} labelStyle={{ color: '#e2e8f0' }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar stackId="captured" dataKey="pull" name="pull" fill="#22c55e" />
                    <Bar stackId="captured" dataKey="observed" name="observed" fill="#3b82f6" />
                    <Bar stackId="captured" dataKey="prompts" name="prompts" fill="#f59e0b" />
                    <Bar stackId="captured" dataKey="feedback" name="feedback" fill="#e879f9" />
                    <Bar stackId="captured" dataKey="edits" name="edits" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <ChartCard title="What it learnt" subtitle="items per kind from the learning folder">
                  <Donut data={donuts.learnt} />
                  {current.learnt.structure > 0 && (
                    <p className="text-[11px] text-slate-400">
                      Structure by audience:{' '}
                      {(Object.entries(current.structureByAudience) as [string, number][])
                        .filter(([, n]) => n > 0)
                        .map(([a, n]) => `${AUDIENCE_TITLE[a] ?? a} ${n}`)
                        .join(', ')}
                    </p>
                  )}
                </ChartCard>
                <ChartCard title="Sources" subtitle="rows pulled or captured per source">
                  <Donut data={donuts.sources} />
                </ChartCard>
              </div>

              <ChartCard title="Audiences" subtitle="human samples and profile status per audience">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th scope="col" className="py-1.5 pr-3 font-medium">Audience</th>
                        <th scope="col" className="py-1.5 pr-3 font-medium">Human samples</th>
                        <th scope="col" className="py-1.5 pr-3 font-medium">Last updated</th>
                        <th scope="col" className="py-1.5 pr-3 font-medium">Profile</th>
                        <th scope="col" className="py-1.5 pr-3 font-medium">Profile samples</th>
                        <th scope="col" className="py-1.5 font-medium">Top markers</th>
                      </tr>
                    </thead>
                    <tbody>
                      {current.audiences.map((a) => (
                        <tr key={a.audience} className="border-b border-slate-800/60">
                          <th scope="row" className="py-1.5 pr-3 font-medium text-slate-200">{AUDIENCE_TITLE[a.audience] ?? a.audience}</th>
                          <td className="py-1.5 pr-3">{a.humanSamples}</td>
                          <td className="py-1.5 pr-3">{a.lastUpdated ?? 'never'}</td>
                          <td className={`py-1.5 pr-3 ${a.profile === 'active' ? 'text-ok' : 'text-warn'}`}>{a.profile}</td>
                          <td className="py-1.5 pr-3">{a.frontmatterSamples ?? 'n/a'}</td>
                          <td className="py-1.5">{a.topMarkers.length ? a.topMarkers.join(', ') : 'none'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ChartCard>

              <ChartCard title="Health">
                <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <Stat label="Last run">
                    {current.health.lastRun ?? 'never'}{' '}
                    <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] ${current.health.stale ? 'bg-amber-950 text-warn' : 'bg-green-950 text-ok'}`}>
                      {current.health.stale ? `stale (over ${current.health.staleDays} days)` : 'fresh'}
                    </span>
                  </Stat>
                  <Stat label="Running now">{current.health.lock ?? 'idle'}</Stat>
                  <Stat label="Coverage from">{current.health.coverageFrom ?? 'unknown'}</Stat>
                  <Stat label="Eval (human)">
                    precision {current.health.eval.precision ?? 'n/a'}, recall {current.health.eval.recall ?? 'n/a'}
                  </Stat>
                  <Stat label="Folder">
                    <span className="break-all font-mono text-xs">{data.folder.display}</span> ({data.folder.via})
                  </Stat>
                  <Stat label="History source">{data.source}</Stat>
                </dl>
              </ChartCard>
            </>
          )}
        </div>
      )}
    </div>
  )
}
