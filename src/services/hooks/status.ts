import { autoDisabledHooks, disabledHooks } from './state'
import type { HookStart, HookStatus } from './types'

const statuses = new Map<string, HookStatus>()

function current(name: string): HookStatus {
  return (
    statuses.get(name) || {
      name,
      lastPollAt: null,
      lastEvent: null,
      usageGateOk: true,
      gateReason: null,
      lastError: null,
      flags: [],
      enabled: true,
      autoPaused: null,
      recent: []
    }
  )
}

export function updateStatus(name: string, patch: Partial<Omit<HookStatus, 'name' | 'recent' | 'enabled' | 'autoPaused'>>): void {
  statuses.set(name, { ...current(name), ...patch })
}

export function recordStart(name: string, start: HookStart): void {
  const status = current(name)
  statuses.set(name, { ...status, lastEvent: start.title, lastError: null, recent: [start, ...status.recent].slice(0, 5) })
}

export function getStatuses(): HookStatus[] {
  const disabled = disabledHooks()
  const auto = autoDisabledHooks()
  return [...statuses.values()].map((s) => ({ ...s, enabled: !disabled.includes(s.name), autoPaused: auto[s.name] || null }))
}
