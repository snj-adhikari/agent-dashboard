import { usePending } from '../progress'

export function Spinner({ label }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center justify-center gap-3 py-24 text-sm text-slate-400">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-brand" />
      {label}
    </div>
  )
}

export function Pending() {
  usePending()
  return <Spinner label="Loading…" />
}
