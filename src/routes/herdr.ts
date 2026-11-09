import type { IncomingMessage, ServerResponse } from 'http'
import { readJsonBody, sendJson } from '../http'
import { HerdrError, focusHerdrAgent, promptHerdrAgent, readHerdrAgent } from '../services/herdr'

function sendError(res: ServerResponse, e: unknown): void {
  const code = e instanceof HerdrError ? e.code : 'failed'
  const status = code === 'agent_blocked' ? 409 : code === 'invalid' ? 400 : 200
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: false, code, error: (e as Error).message }))
}

export async function handleHerdrRead(res: ServerResponse, params: URLSearchParams): Promise<void> {
  try {
    const screen = await readHerdrAgent(params.get('session') || '', params.get('target') || '', Number(params.get('lines')) || 200)
    sendJson(res, { ok: true, screen })
  } catch (e) {
    sendError(res, e)
  }
}

/** Dashboard text is typed by the human, so it goes in untagged. */
export async function handleHerdrPrompt(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { session, target, text } = await readJsonBody(req)
  if (typeof text !== 'string' || !text.trim()) return sendError(res, new HerdrError('text is required', 'invalid'))
  try {
    await promptHerdrAgent(String(session), String(target), text)
    sendJson(res, { ok: true })
  } catch (e) {
    sendError(res, e)
  }
}

export async function handleHerdrFocus(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { session, target } = await readJsonBody(req)
  try {
    sendJson(res, { ok: true, attached: await focusHerdrAgent(String(session), String(target)) })
  } catch (e) {
    sendError(res, e)
  }
}
