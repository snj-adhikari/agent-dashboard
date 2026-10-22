import type { MonitorState } from '../types'

function Stat({ value, label, dot }: { value: number; label: string; dot?: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2.5">
      {dot && <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />}
      <div className="leading-tight">
        <div className="text-xl font-semibold text-slate-100">{value}</div>
        <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      </div>
    </div>
  )
}

export function StatBar({ state }: { state: MonitorState }) {
  const worktreeCount = state.repos.reduce((n, r) => n + r.worktrees.filter((wt) => !wt.isMain).length, 0)
  return (
    <div className="flex flex-wrap gap-3">
      <Stat value={state.repos.length} label="repos" dot="bg-slate-500" />
      <Stat value={worktreeCount} label="worktrees" dot="bg-brand" />
      <Stat value={state.tabs.length} label="cmux tabs" dot="bg-ok" />
      <Stat value={state.agents.length} label="bare agents" dot="bg-warn" />
    </div>
  )
}
