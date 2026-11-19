import type { IncomingMessage, ServerResponse } from 'http'
import { readJsonBody } from '../http'
import type { SideId, SideSettings } from '../services/cuckoo/agents'
import { CuckooError } from '../services/cuckoo/relayLog'
import { isSideId, providerStatus, type Provider } from '../services/cuckoo/side/registry'
import { readSettings, updateSettings } from '../services/cuckoo/side/config'
import { saveUpload, sweepInbox } from '../services/cuckoo/side/upload'
import * as mail from '../services/cuckoo/side/mail'
import * as notes from '../services/cuckoo/side/notes'
import * as whatsapp from '../services/cuckoo/side/whatsapp'
import * as music from '../services/cuckoo/side/music'
import * as crypto from '../services/cuckoo/side/crypto'
import * as services from '../services/cuckoo/side/services'
import * as recap from '../services/cuckoo/side/recap'
import * as phone from '../services/cuckoo/side/phone'

export const PROVIDERS: Provider[] = [mail, whatsapp, music, crypto, services, recap, notes, phone].flatMap((m) => m.providers)
const byId = new Map<SideId, Provider>(PROVIDERS.map((p) => [p.id, p]))

try {
  sweepInbox()
} catch {}

const MAX_NOTE = 200_000
const MAX_TEXT = 4000
const ACTION_RE = /^[a-z]{1,20}$/
const WEEK_RE = /^(\d{4}-W(0[1-9]|[1-4]\d|5[0-3])|all)$/

type Handler = (req: IncomingMessage, url: URL) => Promise<object>

function enabledProvider(id: unknown, settings: SideSettings): Provider {
  const p = isSideId(id) ? byId.get(id) : undefined
  if (!p) throw new CuckooError('bad_request', `unknown side provider ${String(id)}`)
  if (!settings.enabled[p.id]) throw new CuckooError('no_permission', `${p.id} is off in settings`)
  return p
}

const optStr = (v: unknown, field: string, max: number): string | null => {
  if (v == null) return null
  if (typeof v !== 'string' || v.length > max) throw new CuckooError('bad_request', `bad ${field}`)
  return v
}

async function side(): Promise<object> {
  const settings = readSettings()
  return { ok: true, providers: await Promise.all(PROVIDERS.map((p) => providerStatus(p, settings))), settings }
}

async function sideData(id: string): Promise<object> {
  const settings = readSettings()
  const p = enabledProvider(id, settings)
  const data = await p.data(settings)
  if (!data) throw new CuckooError('not_installed', `${p.id} has no data yet`)
  return { ok: true, id: p.id, updatedAt: Date.now(), items: data.items, summary: data.summary }
}

async function sideAction(req: IncomingMessage): Promise<object> {
  const body = await readJsonBody(req)
  const settings = readSettings()
  const p = enabledProvider(body.id, settings)
  const action = body.action
  if (typeof action !== 'string' || !ACTION_RE.test(action) || (action !== 'open' && !p.actions.includes(action))) throw new CuckooError('bad_request', `${p.id} does not allow ${String(action)}`)
  return { ok: true, result: await p.action(action, optStr(body.itemId, 'itemId', 200), optStr(body.text, 'text', MAX_TEXT), settings) }
}

async function sideSettings(req: IncomingMessage): Promise<object> {
  updateSettings(await readJsonBody(req))
  return { ok: true }
}

async function weekRecap(_req: IncomingMessage, url: URL): Promise<object> {
  const week = url.searchParams.get('week') || ''
  if (!WEEK_RE.test(week)) throw new CuckooError('bad_request', 'week must be YYYY-Www or all')
  const settings = readSettings()
  enabledProvider('recap', settings)
  const out = await recap.recap(week, settings)
  if (!out) throw new CuckooError('not_installed', 'recap has no data yet')
  return out
}

async function saveNote(req: IncomingMessage): Promise<object> {
  enabledProvider('notes', readSettings())
  const body = await readJsonBody(req)
  const { title, transcript } = body
  if (typeof title !== 'string' || typeof transcript !== 'string' || !transcript.trim()) throw new CuckooError('bad_request', 'title and transcript are required')
  if (Buffer.byteLength(title) + Buffer.byteLength(transcript) > MAX_NOTE) throw new CuckooError('too_large', 'notes are capped at 200 kB')
  const out = await notes.saveNote({ title, transcript })
  if (!out) throw new CuckooError('not_installed', 'notes are not available yet')
  return out
}

async function upload(req: IncomingMessage): Promise<object> {
  const declared = req.headers['content-length'] ? Number(req.headers['content-length']) : undefined
  const name = req.headers['x-cuckoo-name']
  return saveUpload(req, Array.isArray(name) ? name[0] : name, declared)
}

const ROUTES: Record<string, Handler> = {
  'GET side': side,
  'POST side/action': sideAction,
  'POST side/settings': sideSettings,
  'GET recap': weekRecap,
  'POST notes': saveNote,
  'POST upload': upload,
}

/** Side routes under /api/v1/cuckoo/ (token already checked by the caller); false when the route is not one of them. */
export async function handleCuckooSide(req: IncomingMessage, res: ServerResponse, route: string, url: URL): Promise<boolean> {
  const dataId = req.method === 'GET' && /^side\/([a-z0-9]+)$/.exec(route)?.[1]
  const handler = dataId ? () => sideData(dataId) : ROUTES[`${req.method} ${route}`]
  if (!handler) return false
  try {
    const result = await handler(req, url)
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(result))
  } catch (e) {
    const err = e instanceof CuckooError ? e : new CuckooError('host_failed', (e as Error)?.message || 'side provider failed')
    res.writeHead(err.status, { 'Content-Type': 'application/json', ...(req.complete ? {} : { Connection: 'close' }) })
    res.end(JSON.stringify({ ok: false, error: err.code, message: err.message }), () => {
      if (!req.complete) req.destroy()
    })
  }
  return true
}
