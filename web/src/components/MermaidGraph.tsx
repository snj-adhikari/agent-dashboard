import { useEffect, useRef } from 'react'

declare const mermaid: {
  initialize: (opts: Record<string, unknown>) => void
  run: (opts: { nodes: Element[] }) => Promise<void>
}

let initialized = false

const LEGEND: { label: string; dot: string }[] = [
  { label: 'repo', dot: 'bg-slate-500' },
  { label: 'worktree', dot: 'bg-brand' },
  { label: 'terminal tab', dot: 'bg-ok' },
  { label: 'bare agent', dot: 'bg-warn' }
]

export function MermaidGraph({
  definition,
  onRepoClick,
  onExpandRepo
}: {
  definition: string
  onRepoClick: (repoPath: string) => void
  onExpandRepo: (repoId: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).handleRepoClick = (encodedPath: string) =>
      onRepoClick(decodeURIComponent(encodedPath))
    ;(window as unknown as Record<string, unknown>).handleExpandRepo = (repoId: string) => onExpandRepo(repoId)
  }, [onRepoClick, onExpandRepo])

  useEffect(() => {
    if (!ref.current) return
    if (!initialized) {
      mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' })
      initialized = true
    }
    ref.current.removeAttribute('data-processed')
    ref.current.textContent = definition
    mermaid.run({ nodes: [ref.current] })
  }, [definition])

  return (
    <div className="rounded-2xl bg-gradient-to-b from-slate-900 to-slate-900/60 border border-slate-800 p-5">
      <div className="mb-3 flex flex-wrap gap-4">
        {LEGEND.map((l) => (
          <span key={l.label} className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <span className={`inline-block w-2 h-2 rounded-full ${l.dot}`} />
            {l.label}
          </span>
        ))}
      </div>
      <div className="overflow-auto">
        <div ref={ref} className="mermaid" />
      </div>
    </div>
  )
}
