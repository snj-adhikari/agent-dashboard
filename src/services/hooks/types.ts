export const HOOK_TAB_PREFIX = '[hook:'

export interface TriggerEvent {
  source: string
  id: string
  title: string
  context: string
  repoHint?: string
  action: 'worktree' | 'command' | 'session-command'
  branch?: string
  /** 0 blocker/highest, 1 critical/high, 2 medium (default), 3 low, 4 lowest. */
  priority?: number
  details?: { priority?: string; type?: string; url?: string }
}

export interface Trigger {
  name: string
  poll(): Promise<TriggerEvent[]>
}

export interface HookStart {
  id: string
  title: string
  ref: string
  branch?: string
  url?: string
  at: string
  /** Sent into an existing user session rather than a hook-opened tab. */
  reused?: boolean
}

export interface HookStatus {
  name: string
  lastPollAt: string | null
  lastEvent: string | null
  usageGateOk: boolean
  gateReason: string | null
  lastError: string | null
  /** Non-error notices, e.g. a review skipped because one is already pending. */
  flags: string[]
  enabled: boolean
  autoPaused: { reason: 'idle' | 'queue'; until: number } | null
  recent: HookStart[]
}
