import type { ServerResponse } from 'http'
import { readWorkspaceScreen } from '../services/terminal'
import { sendJson } from '../http'
import { isSurfaceRef } from '../services/cmuxControl'

export function handleScreen(res: ServerResponse, ref: string, surface?: string | null): void {
  try {
    sendJson(res, { ok: true, screen: readWorkspaceScreen(ref, isSurfaceRef(surface) ? surface : undefined) })
  } catch (e) {
    sendJson(res, { ok: false, error: (e as Error).message })
  }
}
