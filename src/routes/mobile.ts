import type { IncomingMessage, ServerResponse } from 'http'
import fs from 'fs'
import path from 'path'
import { readJsonBody, sendJson } from '../http'
import { terminalBackend, terminalTabs } from '../services/terminal'
import { browserAction, browserScreenshot, closeSurface, closeWorkspace, isSurfaceRef, isWorkspaceRef, renameWorkspace, workspaceSurfaces } from '../services/cmuxControl'
import type { BrowserAction } from '../services/cmuxControl'
import { liveSessions } from '../services/hooks/sessions'
import { addSubscription, notify, removeSubscription, vapidPublicKey } from '../services/push'

const MOBILE_PAGE = path.join(__dirname, '..', '..', 'web', 'dist', 'm', 'index.html')

/** build changes on every deploy, so an installed phone app (which has no reload button) can reload itself. */
export function handlePulse(res: ServerResponse): void {
  let build = ''
  try {
    build = String(fs.statSync(MOBILE_PAGE).mtimeMs)
  } catch {}
  sendJson(res, { ok: true, at: new Date().toISOString(), backend: terminalBackend(), build })
}

/** Terminal tabs with the phase their Claude session last reported, waiting ones first. */
export function handleMobileSessions(res: ServerResponse): void {
  const live = liveSessions().reverse()
  const sessions = terminalTabs().map((tab) => {
    const s = live.find((x) => x.workspace && x.workspace === tab.id) || live.find((x) => x.cwd === tab.cwd)
    return { ref: tab.ref, id: tab.id || '', title: s?.ticket || tab.title || path.basename(tab.cwd), cwd: tab.cwd, lastActive: tab.lastActive, phase: s?.phase || '' }
  })
  sendJson(res, { ok: true, sessions: sessions.sort((a, b) => Number(b.phase === 'awaiting-you') - Number(a.phase === 'awaiting-you')) })
}

/** Panes and tabs inside one terminal tab; empty without cmux, where a session has a single screen. */
export function handleMobileSurfaces(res: ServerResponse, ref: string): void {
  if (terminalBackend() !== 'cmux') return sendJson(res, { ok: true, surfaces: [] })
  try {
    sendJson(res, { ok: true, surfaces: workspaceSurfaces(ref) })
  } catch (e) {
    sendJson(res, { ok: false, error: (e as Error).message })
  }
}

export function handleBrowserShot(res: ServerResponse, surface: string | null): void {
  if (!isSurfaceRef(surface)) {
    res.writeHead(400)
    return void res.end()
  }
  try {
    const png = browserScreenshot(surface)
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' })
    res.end(png)
  } catch {
    res.writeHead(502)
    res.end()
  }
}

const fraction = (n: unknown): n is number => typeof n === 'number' && n >= 0 && n <= 1

/** Phone input is validated here before it reaches cmux: http(s) URLs only, tap positions as 0-1 fractions, bounded text. */
export function parseBrowserAction(body: Record<string, unknown>): BrowserAction | null {
  const { action, url, fx, fy, text, enter } = body
  if (action === 'back' || action === 'reload') return { action }
  if (action === 'goto' && typeof url === 'string' && /^https?:\/\/\S{1,2000}$/.test(url)) return { action, url }
  if (action === 'click' && fraction(fx) && fraction(fy)) return { action, fx, fy }
  if (action === 'type' && typeof text === 'string' && text.length <= 2000) return { action, text, enter: enter === true }
  return null
}

export async function handleBrowserAction(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req)
  const action = parseBrowserAction(body)
  if (!isSurfaceRef(body.surface) || !action) return sendJson(res, { ok: false, error: 'invalid surface or action' })
  try {
    browserAction(body.surface, action)
    sendJson(res, { ok: true })
  } catch (e) {
    sendJson(res, { ok: false, error: (e as Error).message })
  }
}

export type TabAction = { action: 'close'; ref: string; surface?: string } | { action: 'rename'; ref: string; title: string }

/** Closing is explicit: a whole tab by its workspace ref, or one pane tab only when its surface ref is given. */
export function parseTabAction(body: Record<string, unknown>): TabAction | null {
  const { action, ref, surface, title } = body
  if (!isWorkspaceRef(ref)) return null
  if (action === 'close' && surface === undefined) return { action, ref }
  if (action === 'close' && isSurfaceRef(surface)) return { action, ref, surface }
  if (action === 'rename' && typeof title === 'string' && /^[^\r\n]{1,60}$/.test(title.trim())) return { action, ref, title: title.trim() }
  return null
}

export async function handleTabAction(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const a = parseTabAction(await readJsonBody(req))
  if (!a || terminalBackend() !== 'cmux') return sendJson(res, { ok: false, error: a ? 'needs cmux' : 'invalid tab action' })
  try {
    if (a.action === 'rename') renameWorkspace(a.ref, a.title)
    else if (a.surface) closeSurface(a.ref, a.surface)
    else closeWorkspace(a.ref)
    sendJson(res, { ok: true })
  } catch (e) {
    sendJson(res, { ok: false, error: (e as Error).message })
  }
}

export function handlePushKey(res: ServerResponse): void {
  sendJson(res, { ok: true, key: vapidPublicKey() })
}

export async function handlePushSubscribe(req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendJson(res, { ok: addSubscription(await readJsonBody(req)) })
}

export async function handlePushUnsubscribe(req: IncomingMessage, res: ServerResponse): Promise<void> {
  removeSubscription(String((await readJsonBody(req)).endpoint || ''))
  sendJson(res, { ok: true })
}

export async function handlePushTest(res: ServerResponse): Promise<void> {
  sendJson(res, { ok: true, sent: await notify({ title: 'Agent Dashboard', body: 'Notifications are working', tag: 'test' }) })
}
