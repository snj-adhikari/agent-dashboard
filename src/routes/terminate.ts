import type { IncomingMessage, ServerResponse } from 'http'
import { terminateAgent } from '../services/processes'
import { readJsonBody, sendJson } from '../http'

export async function handleTerminate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { pid } = await readJsonBody(req)
  try {
    terminateAgent(Number(pid))
    sendJson(res, { ok: true })
  } catch (e) {
    sendJson(res, { ok: false, error: (e as Error).message })
  }
}
