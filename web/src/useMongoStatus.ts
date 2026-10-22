import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { usePolling } from './usePolling'

const CHECK_MS = 60_000

export interface MongoState {
  up: boolean
  error?: string
}

export function useMongoStatus() {
  const [state, setState] = useState<MongoState | null>(null)
  const [popup, setPopup] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [restartError, setRestartError] = useState<string | null>(null)
  const wasUp = useRef<boolean | null>(null)

  const check = useCallback(async (remind = false) => {
    const r = await api.mongoStatus().catch(() => null)
    if (!r?.ok) return
    const alreadyDown = wasUp.current === false
    wasUp.current = r.up
    setState({ up: r.up, error: r.error })
    if (r.up) setPopup(false)
    else if (!alreadyDown || remind) setPopup(true)
  }, [])

  usePolling(() => void check(), CHECK_MS)

  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) void check(true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [check])

  const restart = useCallback(async () => {
    setRestarting(true)
    setRestartError(null)
    try {
      const r = await api.restartMongo()
      if (!r.ok) setRestartError(r.error || 'restart failed')
      await check()
    } catch (e) {
      setRestartError((e as Error).message)
    } finally {
      setRestarting(false)
    }
  }, [check])

  return { state, popup, dismiss: () => setPopup(false), restarting, restartError, restart }
}

export type MongoStatus = ReturnType<typeof useMongoStatus>
