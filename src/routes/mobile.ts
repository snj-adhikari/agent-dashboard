import type { IncomingMessage, ServerResponse } from 'http'
import path from 'path'
import { readJsonBody, sendJson } from '../http'
import { terminalBackend, terminalTabs } from '../services/terminal'
import { liveSessions } from '../services/hooks/sessions'
import { addSubscription, notify, removeSubscription, vapidPublicKey } from '../services/push'

export function handlePulse(res: ServerResponse): void {
  sendJson(res, { ok: true, at: new Date().toISOString(), backend: terminalBackend() })
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
  sendJson(res, { ok: true, sent: await notify({ title: 'Agent Monitor', body: 'Notifications are working', tag: 'test' }) })
}
