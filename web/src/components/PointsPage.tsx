import { signed, type DemeritsResponse } from '../api'
import { EmptyState } from './EmptyState'

const tone = (n: number): string => (n < 0 ? 'text-red-300' : n > 0 ? 'text-emerald-300' : 'text-slate-400')
const time = (ts: number): string => new Date(ts).toLocaleString()

export function PointsPage({ data }: { data: DemeritsResponse | null }) {
  if (!data) return <EmptyState label="No points data yet" />
  const agents = [...data.agents].sort((a, b) => b.balance - a.balance)
  return (
    <div className="space-y-6">
      <section>
        <div className="mb-2 flex items-baseline gap-3 text-sm text-slate-300">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Leaderboard</h2>
          <span className="tabular-nums">
            Team pool {data.pool.balance} <span className={tone(data.pool.week)}>{signed(data.pool.week)} this week</span>
          </span>
          <span className="ml-auto text-[11px] text-slate-500">source: {data.source}</span>
        </div>
        {agents.length ? (
          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60">
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  {['Agent', 'Rank', 'Balance', 'Week', 'XP', 'Level', 'Biased'].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {agents.map((a) => (
                  <tr key={a.agent} className="border-t border-slate-800/60">
                    <td className="px-3 py-1.5 font-medium text-slate-200">{a.agent}</td>
                    <td className="px-3 py-1.5 text-slate-400">{a.rank}</td>
                    <td className="px-3 py-1.5 text-slate-200">{a.balance}</td>
                    <td className={`px-3 py-1.5 ${tone(a.week)}`}>{signed(a.week)}</td>
                    <td className="px-3 py-1.5 text-slate-300">{a.xp}</td>
                    <td className="px-3 py-1.5 text-slate-300">{a.level}</td>
                    <td className="px-3 py-1.5 text-amber-300">{a.biased ? 'yes' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState label="No agents have points yet" />
        )}
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Recent events</h2>
        {data.events.length ? (
          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60">
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  {['Time', 'Agent', 'Scope', 'Given by', 'Points', 'Rule', 'Reason'].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.events.map((e) => (
                  <tr key={e.id} className="border-t border-slate-800/60 align-top">
                    <td className="whitespace-nowrap px-3 py-1.5 text-slate-400">{time(e.ts)}</td>
                    <td className="px-3 py-1.5 text-slate-200">{e.scope === 'pool' ? 'pool' : e.agent}</td>
                    <td className="px-3 py-1.5 text-slate-400">{e.scope}</td>
                    <td className="px-3 py-1.5 text-slate-300">{e.by}</td>
                    <td className={`px-3 py-1.5 tabular-nums ${tone(e.points)}`}>{signed(e.points)}</td>
                    <td className="px-3 py-1.5 font-mono text-xs text-slate-300">{e.rule}</td>
                    <td className="px-3 py-1.5 text-slate-300">{e.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState label="No events yet" />
        )}
      </section>
    </div>
  )
}
