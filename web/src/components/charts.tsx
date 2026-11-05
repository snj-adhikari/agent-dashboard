export const PIE_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#ef4444', '#84cc16']
export const OTHER_COLOR = '#64748b'

export function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 mb-5">
      <h2 className="text-sm font-medium text-slate-300">{title}</h2>
      {subtitle && <p className="text-[11px] text-slate-600 mb-2">{subtitle}</p>}
      {children}
    </div>
  )
}
