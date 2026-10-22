import type { IncomingMessage, ServerResponse } from 'http'
import { removeRefusal, removeWorktree } from '../services/repos'
import { currentActiveCwds } from '../services/state'
import { readJsonBody, sendJson } from '../http'
import { invalidateInactiveCache } from './inactiveWorktrees'

export async function handleRemoveWorktree(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { path: worktreePath, force } = await readJsonBody(req)
  const refusal = await removeRefusal(String(worktreePath), currentActiveCwds())
  if (refusal) return sendJson(res, { ok: false, error: refusal })
  try {
    await removeWorktree(String(worktreePath), Boolean(force))
    invalidateInactiveCache()
    sendJson(res, { ok: true })
  } catch (e) {
    const err = e as { stderr?: string; message?: string }
    sendJson(res, { ok: false, error: (err.stderr || err.message || '').toString().trim() })
  }
}
