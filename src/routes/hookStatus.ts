import type { IncomingMessage, ServerResponse } from 'http'
import path from 'path'
import { getStatuses } from '../services/hooks/status'
import { hookNames, queueItems, rescheduleHook, runQueued, startJiraTicket } from '../services/hooks'
import { hookSessions, recordSession } from '../services/hooks/sessions'
import { setHookEnabled, setHookInterval } from '../services/hooks/state'
import { loadConfig, validInterval } from '../services/hooks/config'
import { readJsonBody, sendJson } from '../http'
import { notify } from '../services/push'

export function handleHookStatus(res: ServerResponse): void {
  sendJson(res, { ok: true, hooks: getStatuses(), queue: queueItems(), sessions: hookSessions(), maxConcurrent: loadConfig().maxConcurrent })
}

export async function handleHookSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const entry = recordSession(await readJsonBody(req))
  if (!entry) return sendError(res, 400, 'sessionId is required')
  if (entry.phase === 'awaiting-you') {
    const where = entry.ticket || path.basename(entry.cwd) || 'Claude'
    notify({ title: `${where} is waiting for you`, body: entry.branch || entry.cwd, ref: entry.workspace, tag: entry.sessionId }).catch(() => undefined)
  }
  sendJson(res, { ok: true })
}

export async function handleJiraStart(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { key } = await readJsonBody(req)
  try {
    sendJson(res, { ok: true, ...(await startJiraTicket(String(key || '').trim().toUpperCase())) })
  } catch (e) {
    const err = e as { stderr?: string; message?: string }
    sendJson(res, { ok: false, error: (err.stderr || err.message || '').toString().trim() })
  }
}

export async function handleRunQueued(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { id } = await readJsonBody(req)
  try {
    sendJson(res, { ok: true, start: await runQueued(id ? String(id) : undefined) })
  } catch (e) {
    const err = e as { stderr?: string; message?: string }
    sendJson(res, { ok: false, error: (err.stderr || err.message || '').toString().trim() })
  }
}

function sendError(res: ServerResponse, status: number, error: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: false, error }))
}

function resolveHook(res: ServerResponse, rawName: string): string | null {
  let name: string
  try {
    name = decodeURIComponent(rawName)
  } catch {
    sendError(res, 400, 'invalid hook name')
    return null
  }
  if (hookNames().includes(name)) return name
  sendError(res, 404, `unknown hook ${name}`)
  return null
}

export async function handleHookInterval(req: IncomingMessage, res: ServerResponse, rawName: string): Promise<void> {
  const { minutes } = await readJsonBody(req)
  const name = resolveHook(res, rawName)
  if (!name) return
  if (!validInterval(minutes)) return sendError(res, 400, 'minutes must be a whole number from 5 to 1440')
  setHookInterval(name, minutes)
  rescheduleHook(name)
  sendJson(res, { ok: true, name, minutes })
}

export async function handleHookEnabled(req: IncomingMessage, res: ServerResponse, rawName: string): Promise<void> {
  const { enabled } = await readJsonBody(req)
  const name = resolveHook(res, rawName)
  if (!name) return
  if (typeof enabled !== 'boolean') {
    sendError(res, 400, 'enabled must be a boolean')
    return
  }
  setHookEnabled(name, enabled)
  sendJson(res, { ok: true, name, enabled })
}
