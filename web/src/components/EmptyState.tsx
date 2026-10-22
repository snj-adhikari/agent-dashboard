export function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-800 p-4 text-center text-xs text-slate-600">
      {label}
    </div>
  )
}
