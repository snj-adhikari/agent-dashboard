import type { IncomingMessage, ServerResponse } from 'http'
import { sendToWorkspace } from '../services/terminal'
import { readJsonBody, sendJson } from '../http'
import { isSurfaceRef } from '../services/cmuxControl'

export async function handleSend(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { ref, text, surface } = await readJsonBody(req)
  try {
    sendToWorkspace(String(ref), String(text), isSurfaceRef(surface) ? surface : undefined)
    sendJson(res, { ok: true })
  } catch (e) {
    sendJson(res, { ok: false, error: (e as Error).message })
  }
}
