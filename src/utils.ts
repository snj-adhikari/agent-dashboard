import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { MonitorState } from './types'
import { settings } from './services/settings'

export function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p
}

/** WATCH_DIRS env overrides the repo folders saved in the setup guide. */
export function watchDirs(): string[] {
  const fromEnv = process.env.WATCH_DIRS
  const dirs = fromEnv ? fromEnv.split(',') : settings().repoDirs || []
  return dirs.map((d) => d.trim()).filter(Boolean).map(expandHome)
}

export function sh(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  } catch {
    return ''
  }
}

// macOS paths are case-insensitive, so two spellings of one folder must compare equal
export function normPath(p: string): string {
  let real = p
  try {
    real = fs.realpathSync(p)
  } catch {}
  return real.replace(/\/+$/, '').toLowerCase()
}

export function isUnder(cwd: string, root: string): boolean {
  return cwd === root || cwd.startsWith(`${root}/`)
}

export function activeCwds(state: Pick<MonitorState, 'tabs' | 'agents'>): Set<string> {
  return new Set([...state.tabs.map((t) => t.cwd), ...state.agents.map((a) => a.cwd)].filter(Boolean).map(normPath))
}

export function isActiveWorktree(wtPath: string, active: Set<string>): boolean {
  const root = normPath(wtPath)
  return [...active].some((cwd) => isUnder(cwd, root))
}

export function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9_]/g, '_')
}

export function timeAgo(iso: string | undefined): string | null {
  if (!iso) return null
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}
