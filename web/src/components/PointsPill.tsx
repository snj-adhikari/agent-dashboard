import { signed, type DemeritsResponse } from '../api'

export function PointsPill({ data, onOpen }: { data: DemeritsResponse | null; onOpen: () => void }) {
  if (!data) return null
  const { balance, week } = data.pool
  const tone = week < 0 ? 'text-red-300' : week > 0 ? 'text-emerald-300' : 'text-slate-300'
  return (
    <button
      onClick={onOpen}
      aria-label={`Team points ${balance}, ${signed(week)} this week. Open points`}
      className="rounded-full border border-slate-800 bg-slate-900/80 px-3 py-1 text-xs font-medium tabular-nums text-slate-200 transition-colors hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
    >
      {balance} <span className={tone}>{signed(week)}</span>
    </button>
  )
}
