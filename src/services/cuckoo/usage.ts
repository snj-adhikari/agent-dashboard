import fs from 'fs'
import os from 'os'
import path from 'path'
import { hookSettings } from '../hooks/config'

const STALE_AFTER_S = 2 * 60 * 60

interface UsageWindow {
  used_percentage: number
  resets_at: string | number
}

export interface UsageState {
  five_hour: UsageWindow
  seven_day: UsageWindow
  updated_at: number
}

export interface ClaudeUsage {
  fiveHour: number | null
  sevenDay: number | null
  resetsAt: number | null
  stale: boolean
}

/** The configured path, else the statusline's default, so usage works before (or without) settings loading from Mongo. */
export function usageFile(configured = hookSettings().usageStatePath): string {
  const set = (configured || '').trim()
  return set ? set.replace(/^~(?=\/|$)/, os.homedir()) : path.join(os.homedir(), '.claude', 'usage-state.json')
}

export function readUsageFile(file = usageFile(), nowS = Date.now() / 1000): UsageState | null {
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8')) as UsageState
    return nowS - state.updated_at > STALE_AFTER_S ? null : state
  } catch {
    return null
  }
}

/** A missing file and one older than 2 h both report as stale with null numbers. */
export function claudeUsage(read: () => UsageState | null = readUsageFile): { claude: ClaudeUsage } {
  const state = read()
  if (!state) return { claude: { fiveHour: null, sevenDay: null, resetsAt: null, stale: true } }
  const resets = Number(state.five_hour.resets_at)
  return {
    claude: {
      fiveHour: state.five_hour.used_percentage,
      sevenDay: state.seven_day.used_percentage,
      resetsAt: Number.isFinite(resets) ? resets : null,
      stale: false
    }
  }
}
