import type { IncomingMessage, ServerResponse } from 'http'
import { sendToWorkspace } from '../services/terminal'
import { readJsonBody, sendJson } from '../http'

export async function handleSend(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { ref, text } = await readJsonBody(req)
  try {
    sendToWorkspace(String(ref), String(text))
    sendJson(res, { ok: true })
  } catch (e) {
    sendJson(res, { ok: false, error: (e as Error).message })
  }
}
