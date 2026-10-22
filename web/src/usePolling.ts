import { useEffect, useRef } from 'react'

export const POLL_MS = 3 * 60_000

/** Runs fn now and every intervalMs, but only while the browser tab is visible; a changed restartKey refetches at once. */
export function usePolling(fn: () => void, intervalMs: number, restartKey?: unknown): void {
  const latest = useRef(fn)
  latest.current = fn

  useEffect(() => {
    let id: number | undefined
    const stop = () => {
      if (id !== undefined) window.clearInterval(id)
      id = undefined
    }
    const start = () => {
      stop()
      latest.current()
      id = window.setInterval(() => latest.current(), intervalMs)
    }
    const onVisibility = () => (document.hidden ? stop() : start())
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs, restartKey])
}
