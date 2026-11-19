import type { IncomingMessage, ServerResponse } from 'http'
import { ingest, snapshot } from '../services/demerits'
import { readJsonBody, sendJson } from '../http'

export async function handleDemerits(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (req.method === 'POST') {
      const body = await readJsonBody(req)
      sendJson(res, await ingest(body.event, typeof body.ledgerDir === 'string' ? body.ledgerDir : undefined))
      return
    }
    sendJson(res, await snapshot())
  } catch (e) {
    sendJson(res, { ok: false, error: (e as Error).message })
  }
}
