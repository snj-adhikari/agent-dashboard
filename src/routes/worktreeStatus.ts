import type { ServerResponse } from 'http'
import { worktreeStatus } from '../services/repos'
import { sendJson } from '../http'

export async function handleWorktreeStatus(res: ServerResponse, worktreePath: string): Promise<void> {
  const info = await worktreeStatus(worktreePath)
  sendJson(res, { ok: true, ...info })
}
