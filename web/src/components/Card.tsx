import type { ReactNode } from 'react'

export function Card({ children, accent }: { children: ReactNode; accent?: 'green' | 'amber' | 'blue' }) {
  const accentBorder =
    accent === 'green'
      ? 'border-l-ok'
      : accent === 'amber'
        ? 'border-l-warn'
        : accent === 'blue'
          ? 'border-l-brand'
          : 'border-l-slate-700'

  return (
    <div
      className={`rounded-lg border border-slate-800 border-l-2 ${accentBorder} bg-slate-900/60 p-3 mb-2 text-sm transition-colors hover:border-slate-700 hover:bg-slate-900`}
    >
      {children}
    </div>
  )
}

export function CardPath({ children }: { children: ReactNode }) {
  return <div className="text-slate-500 text-[11px] font-mono break-all mt-0.5">{children}</div>
}

export function CardMeta({ children }: { children: ReactNode }) {
  return <div className="text-slate-400 text-[11px] my-1.5">{children}</div>
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" width="1em" height="1em">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}

export function Button({
  danger,
  primary,
  loading,
  onClick,
  children
}: {
  danger?: boolean
  primary?: boolean
  loading?: boolean
  onClick: () => void
  children: ReactNode
}) {
  const style = danger
    ? 'bg-red-950 text-red-300 hover:bg-red-900 border-red-900/50'
    : primary
      ? 'bg-brand-dark text-white hover:bg-brand border-brand'
      : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border-slate-700'

  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium mr-1.5 mb-1 transition-colors disabled:opacity-60 disabled:cursor-wait ${style}`}
    >
      {loading && <Spinner />}
      {children}
    </button>
  )
}
