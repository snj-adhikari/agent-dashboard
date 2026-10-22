import type { ServerResponse } from 'http'
import { readWorkspaceScreen } from '../services/terminal'
import { sendJson } from '../http'

export function handleScreen(res: ServerResponse, ref: string): void {
  try {
    sendJson(res, { ok: true, screen: readWorkspaceScreen(ref) })
  } catch (e) {
    sendJson(res, { ok: false, error: (e as Error).message })
  }
}
