import { useEffect, useRef, useState } from 'react'
import { useInflight } from '../progress'

type Phase = 'run' | 'done' | 'idle'

const SETTLE_MS = 350

export function RouteProgress({ view }: { view: string }) {
  const inflight = useInflight()
  const [phase, setPhase] = useState<Phase>('run')
  const [width, setWidth] = useState(0)
  const startedAt = useRef(performance.now())

  useEffect(() => {
    startedAt.current = performance.now()
    setPhase('run')
    setWidth(0)
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setWidth(85)))
    return () => cancelAnimationFrame(frame)
  }, [view])

  useEffect(() => {
    if (phase !== 'run' || inflight > 0) return
    const wait = Math.max(0, SETTLE_MS - (performance.now() - startedAt.current))
    const t = window.setTimeout(() => {
      setWidth(100)
      setPhase('done')
    }, wait)
    return () => window.clearTimeout(t)
  }, [phase, inflight])

  useEffect(() => {
    if (phase !== 'done') return
    const t = window.setTimeout(() => setPhase('idle'), 600)
    return () => window.clearTimeout(t)
  }, [phase])

  if (phase === 'idle') return null
  return (
    <div
      role="progressbar"
      aria-label="Loading page"
      className="pointer-events-none fixed left-0 top-0 z-50 h-0.5 bg-gradient-to-r from-brand to-ok shadow-[0_0_8px_var(--color-brand)]"
      style={{
        width: `${width}%`,
        opacity: phase === 'done' ? 0 : 1,
        transition: phase === 'done' ? 'width 200ms ease-out, opacity 350ms ease 200ms' : 'width 6s cubic-bezier(0.1, 0.8, 0.2, 1)'
      }}
    />
  )
}
