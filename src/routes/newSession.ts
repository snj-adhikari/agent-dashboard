import type { IncomingMessage, ServerResponse } from 'http'
import { createWorktreeSession } from '../services/newSession'
import { readJsonBody, sendJson } from '../http'

export async function handleNewSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { repoPath, branch } = await readJsonBody(req)
  try {
    const workspaceRef = createWorktreeSession(String(repoPath), String(branch))
    sendJson(res, { ok: true, workspaceRef })
  } catch (e) {
    const err = e as { stderr?: string; message?: string }
    sendJson(res, { ok: false, error: (err.stderr || err.message || '').toString().trim() })
  }
}
