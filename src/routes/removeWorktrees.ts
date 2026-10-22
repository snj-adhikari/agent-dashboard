import type { IncomingMessage, ServerResponse } from 'http'
import { removeWorktrees } from '../services/repos'
import { currentActiveCwds } from '../services/state'
import { readJsonBody, sendJson } from '../http'
import { invalidateInactiveCache } from './inactiveWorktrees'

export async function handleRemoveWorktrees(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { paths, force } = await readJsonBody(req)
  const results = await removeWorktrees(Array.isArray(paths) ? paths.map(String) : [], Boolean(force), currentActiveCwds())
  invalidateInactiveCache()
  sendJson(res, { ok: results.every((r) => r.ok), results })
}
