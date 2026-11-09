import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

const cmux = (args: string[]): string => execFileSync('cmux', args, { encoding: 'utf8', timeout: 15_000 })
const surfaceArgs = (surface?: string): string[] => (surface ? ['--surface', surface] : [])

export const isWorkspaceRef = (s: unknown): s is string => typeof s === 'string' && /^(workspace:\d+|[0-9A-Fa-f-]{36})$/.test(s)

export const isSurfaceRef = (s: unknown): s is string => typeof s === 'string' && /^(surface:\d+|[0-9A-Fa-f-]{36})$/.test(s)

export function sendToWorkspace(ref: string, text: string, surface?: string): void {
  cmux(['send', '--workspace', ref, ...surfaceArgs(surface), `${text}\n`])
}

export function sendKey(ref: string, key: string): void {
  execFileSync('cmux', ['send-key', '--workspace', ref, key], { encoding: 'utf8' })
}

export function readWorkspaceScreen(ref: string, surface?: string): string {
  return cmux(['read-screen', '--workspace', ref, ...surfaceArgs(surface)])
}

export interface CmuxSurface {
  ref: string
  type: string
  title: string
  focused: boolean
}

/** Every pane's surfaces in a workspace (terminals and browser tabs); focused is the selected surface of the focused pane. */
export function workspaceSurfaces(ref: string): CmuxSurface[] {
  const panes = JSON.parse(cmux(['--json', 'list-panes', '--workspace', ref])).panes as { ref: string; focused: boolean }[]
  return panes.flatMap((pane) => {
    const { surfaces } = JSON.parse(cmux(['--json', 'list-pane-surfaces', '--workspace', ref, '--pane', pane.ref])) as {
      surfaces: { ref: string; type: string; title?: string; selected: boolean }[]
    }
    return surfaces.map((s) => ({ ref: s.ref, type: s.type, title: s.title || '', focused: pane.focused && s.selected }))
  })
}

export const PERMANENT_WORKSPACES = ['Drive - PR Review', 'Drive - Generic']

export const isPermanentTitle = (title: string): boolean => PERMANENT_WORKSPACES.includes(title.trim())

interface CmuxWorkspace {
  ref: string
  id: string
  title: string
}

export function listWorkspaces(): CmuxWorkspace[] {
  const { workspaces } = JSON.parse(cmux(['workspace', 'list', '--json'])) as { workspaces: Record<string, unknown>[] }
  return workspaces.map((w) => ({ ref: String(w.ref || ''), id: String(w.id || ''), title: String(w.custom_title || w.title || '') }))
}

export function closeWorkspace(ref: string): void {
  const ws = listWorkspaces().find((w) => w.ref === ref || w.id === ref)
  if (ws && isPermanentTitle(ws.title)) throw new Error(`"${ws.title}" is a permanent workspace and is never closed`)
  cmux(['close-workspace', '--workspace', ref])
}

/** The rightmost pane other than the first, where repeat runs stack up as tabs. */
export function sidePane(panes: { ref: string; pixel_frame?: { x?: number } }[]): string | undefined {
  return panes
    .slice(1)
    .sort((a, b) => (b.pixel_frame?.x ?? 0) - (a.pixel_frame?.x ?? 0))[0]?.ref
}

/** Runs a command as a tab in the workspace's side pane (split once), creating the workspace when missing. */
export function openInTitledWorkspace(title: string, cwd: string, command: string): string {
  const ws = listWorkspaces().find((w) => w.title === title)
  if (!ws) return openCmuxTab(title, cwd, command)
  const shellCommand = `cd ${shellQuote(cwd)} && ${command}`
  const pane = sidePane(JSON.parse(cmux(['--json', 'list-panes', '--workspace', ws.ref])).panes || [])
  if (pane) cmux(['new-surface', '--workspace', ws.ref, '--pane', pane, '--working-directory', cwd, '--command', shellCommand])
  else cmux(['new-split', 'right', '--workspace', ws.ref, '--command', shellCommand, '--focus', 'false'])
  return ws.ref
}

/** Always names the surface: without --surface, cmux closes whichever one is focused. */
export function closeSurface(ref: string, surface: string): void {
  cmux(['close-surface', '--workspace', ref, '--surface', surface])
}

export function renameWorkspace(ref: string, title: string): void {
  cmux(['rename-workspace', '--workspace', ref, '--', title])
}

export function browserScreenshot(surface: string): Buffer {
  const file = path.join(os.tmpdir(), `am-shot-${process.pid}-${Date.now()}.png`)
  try {
    cmux(['browser', surface, 'screenshot', '--out', file])
    return fs.readFileSync(file)
  } finally {
    fs.rmSync(file, { force: true })
  }
}

export type BrowserAction =
  | { action: 'goto'; url: string }
  | { action: 'back' | 'reload' }
  | { action: 'click'; fx: number; fy: number }
  | { action: 'type'; text: string; enter: boolean }

/** Clicks and typing go through page JS: cmux browser targets CSS selectors, while the phone only knows where on the screenshot it was tapped. */
export function browserAction(surface: string, a: BrowserAction): void {
  switch (a.action) {
    case 'goto':
      cmux(['browser', surface, 'goto', a.url])
      break
    case 'back':
    case 'reload':
      cmux(['browser', surface, a.action])
      break
    case 'click':
      cmux(['browser', surface, 'eval', `(() => { const el = document.elementFromPoint(innerWidth * ${a.fx}, innerHeight * ${a.fy}); if (el) { el.focus?.(); el.click(); } })()`])
      break
    case 'type':
      cmux(['browser', surface, 'eval', `document.execCommand('insertText', false, ${JSON.stringify(a.text)})`])
      if (a.enter) cmux(['browser', surface, 'press', 'Enter'])
  }
}

export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

export function claudeCommand(prompt?: string, env: Record<string, string> = {}): string {
  const vars = Object.entries(env).map(([k, v]) => `${k}=${shellQuote(v)} `).join('')
  return `${vars}${prompt ? `claude ${shellQuote(prompt.replace(/[\r\n]+/g, ' '))}` : 'claude'}`
}

// cmux types --command into the user's shell, so a prompt must be shell-quoted to arrive as one argument.
export function openCmuxTab(name: string, cwd: string, command: string): string {
  const out = execFileSync(
    'cmux',
    ['workspace', 'create', '--name', name, '--cwd', cwd, '--command', command, '--focus', 'false'],
    { encoding: 'utf8' }
  )
  return out.trim().replace(/^OK\s+/, '')
}
