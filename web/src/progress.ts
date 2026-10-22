import { useEffect, useSyncExternalStore } from 'react'

let inflight = 0
const listeners = new Set<() => void>()

function bump(delta: number): void {
  inflight += delta
  listeners.forEach((l) => l())
}

export function trackedFetch(...args: Parameters<typeof fetch>): Promise<Response> {
  bump(1)
  return fetch(...args).finally(() => bump(-1))
}

export function useInflight(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => inflight
  )
}

/** Counts as in-flight work while the calling component is mounted, e.g. a lazy route chunk loading. */
export function usePending(): void {
  useEffect(() => {
    bump(1)
    return () => bump(-1)
  }, [])
}
