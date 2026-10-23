import { execFileSync } from 'child_process'
import os from 'os'
import { timeAgo } from '../utils'
import { claudeSessionIdForCwd } from './processes'
import { settings } from './settings'
import { cmuxWorkspaces } from './cmux'
import * as cmux from './cmuxControl'
import type { CmuxTab } from '../types'

export type TerminalBackend = 'cmux' | 'tmux' | 'terminal'
export type TerminalChoice = 'auto' | TerminalBackend

export const TMUX_PREFIX = 'ad-'
const UNSUPPORTED = 'not supported without cmux or tmux'
const TMUX_KEYS: Record<string, string> = { escape: 'Escape', enter: 'Enter', tab: 'Tab', up: 'Up', down: 'Down', left: 'Left', right: 'Right' }

const run = (cmd: string, args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

function available(cmd: string, args: string[]): boolean {
  try {
    run(cmd, args)
    return true
  } catch {
    return false
  }
}

export function tmuxName(name: string, taken: string[] = []): string {
  const base = TMUX_PREFIX + (name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'session')
  let out = base
  for (let i = 2; taken.includes(out); i++) out = `${base}-${i}`
  return out
}

export function tmuxKey(key: string): string {
  return TMUX_KEYS[key.toLowerCase()] || key
}

let detected: { at: number; backend: TerminalBackend } | null = null

function detect(): TerminalBackend {
  if (available('cmux', ['workspace', 'list', '--json'])) return 'cmux'
  return available('tmux', ['-V']) ? 'tmux' : 'terminal'
}

export function terminalBackend(): TerminalBackend {
  const choice = (process.env.TERMINAL_BACKEND || settings().terminal || 'auto') as TerminalChoice
  if (choice !== 'auto') return choice
  if (!detected || Date.now() - detected.at > 30_000) detected = { at: Date.now(), backend: detect() }
  return detected.backend
}

export function terminalInfo(): { backend: TerminalBackend; canSend: boolean; canRead: boolean } {
  const backend = terminalBackend()
  const can = backend !== 'terminal'
  return { backend, canSend: can, canRead: can }
}

function tmuxTabs(): CmuxTab[] {
  let raw = ''
  try {
    raw = run('tmux', ['list-panes', '-a', '-F', '#{session_name}\t#{pane_current_path}\t#{session_activity}'])
  } catch {
    return []
  }
  const seen = new Set<string>()
  const tabs: CmuxTab[] = []
  for (const line of raw.split('\n')) {
    const [name, path = '', activity = ''] = line.split('\t')
    if (!name?.startsWith(TMUX_PREFIX) || seen.has(name)) continue
    seen.add(name)
    const cwd = path.replace(/\/$/, '')
    tabs.push({
      ref: name,
      cwd,
      title: name.slice(TMUX_PREFIX.length),
      lastActive: activity ? timeAgo(new Date(Number(activity) * 1000).toISOString()) : null,
      sessionId: claudeSessionIdForCwd(cwd)
    })
  }
  return tabs
}

export function terminalTabs(): CmuxTab[] {
  const backend = terminalBackend()
  if (backend === 'cmux') return cmuxWorkspaces()
  return backend === 'tmux' ? tmuxTabs() : []
}

export function sendToWorkspace(ref: string, text: string, surface?: string): void {
  const backend = terminalBackend()
  if (backend === 'cmux') return cmux.sendToWorkspace(ref, text, surface)
  if (backend !== 'tmux') throw new Error(UNSUPPORTED)
  run('tmux', ['send-keys', '-t', ref, '-l', text])
  run('tmux', ['send-keys', '-t', ref, 'Enter'])
}

export function sendKey(ref: string, key: string): void {
  const backend = terminalBackend()
  if (backend === 'cmux') return cmux.sendKey(ref, key)
  if (backend !== 'tmux') throw new Error(UNSUPPORTED)
  run('tmux', ['send-keys', '-t', ref, tmuxKey(key)])
}

export function readWorkspaceScreen(ref: string, surface?: string): string {
  const backend = terminalBackend()
  if (backend === 'cmux') return cmux.readWorkspaceScreen(ref, surface)
  if (backend !== 'tmux') throw new Error(UNSUPPORTED)
  return run('tmux', ['capture-pane', '-p', '-t', ref, '-S', '-200'])
}

function osascriptTerminal(shellCommand: string): void {
  run('osascript', ['-e', `tell application "Terminal" to do script ${JSON.stringify(shellCommand)}`])
}

function openTmux(name: string, cwd: string, command: string): string {
  const taken = tmuxTabs().map((t) => t.ref)
  const session = tmuxName(name, taken)
  run('tmux', ['new-session', '-d', '-s', session, '-c', cwd, command])
  const openWindow = settings().terminalOpenWindow ?? process.platform === 'darwin'
  if (openWindow && process.platform === 'darwin' && /^[A-Za-z0-9._-]+$/.test(session)) osascriptTerminal(`tmux attach -t ${session}`)
  return session
}

export function openTab(name: string, cwd: string, command: string): string {
  const backend = terminalBackend()
  if (backend === 'cmux') return cmux.openCmuxTab(name, cwd, command)
  if (backend === 'tmux') return openTmux(name, cwd, command)
  if (process.platform !== 'darwin') throw new Error('Terminal.app is only available on macOS; install tmux')
  osascriptTerminal(`cd ${cmux.shellQuote(cwd)} && ${command}`)
  return name
}

export function openClaudeTab(name: string, cwd: string, prompt?: string, env: Record<string, string> = {}): string {
  return openTab(name, cwd, cmux.claudeCommand(prompt, env))
}

export function openOpUnlockTab(): string {
  return openTab('op-unlock', os.homedir(), 'op signin')
}
