import fs from 'fs'
import os from 'os'
import { hookSettings, loadConfig } from './config'

const HARD_STOP_PCT = 97
const STALE_AFTER_S = 2 * 60 * 60

interface UsageWindow {
  used_percentage: number
  resets_at: string
}

interface UsageState {
  five_hour: UsageWindow
  seven_day: UsageWindow
  updated_at: number
}

export interface GateResult {
  ok: boolean
  reason: string | null
}

function usagePath(): string {
  return (hookSettings().usageStatePath || '').trim().replace(/^~(?=\/|$)/, os.homedir())
}

function readUsage(): UsageState | null {
  const file = usagePath()
  if (!file) return null
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8')) as UsageState
    return Date.now() / 1000 - state.updated_at > STALE_AFTER_S ? null : state
  } catch {
    return null
  }
}

function resetsAt(window: UsageWindow): string {
  return new Date(Number(window.resets_at) * 1000).toLocaleString('en-AU', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
}

function check(fiveHourLimit: number, sevenDayLimit: number): GateResult {
  if (!usagePath()) return { ok: true, reason: null }
  const state = readUsage()
  if (!state) return { ok: false, reason: 'usage state file missing or stale (>2h)' }
  const { five_hour: fiveHour, seven_day: sevenDay } = state
  if (fiveHour.used_percentage >= fiveHourLimit) {
    return { ok: false, reason: `5h usage ${fiveHour.used_percentage}% ≥ ${fiveHourLimit}% — resets ${resetsAt(fiveHour)}` }
  }
  if (sevenDay.used_percentage >= sevenDayLimit) {
    return { ok: false, reason: `7d usage ${sevenDay.used_percentage}% ≥ ${sevenDayLimit}% — resets ${resetsAt(sevenDay)}` }
  }
  return { ok: true, reason: null }
}

/** Whether new work may start now; blocked work waits in the queue. */
export function checkStartGate(): GateResult {
  const { gate } = loadConfig()
  return check(gate.fiveHourPct, gate.sevenDayPct)
}

/** Polling keeps capturing tickets while starts are gated; only the hard stop halts it. */
export function checkPollGate(): GateResult {
  return check(HARD_STOP_PCT, HARD_STOP_PCT)
}

export function sessionUsageHalt(): boolean {
  const state = readUsage()
  return state !== null && state.five_hour.used_percentage >= loadConfig().gate.fiveHourPct
}

export function fiveHourUsage(): { pct: number; resetsAt: number } | null {
  const state = readUsage()
  return state && { pct: state.five_hour.used_percentage, resetsAt: Number(state.five_hour.resets_at) }
}
