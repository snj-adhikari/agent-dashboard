import type { ServerResponse } from 'http'
import { collectState } from '../services/state'
import { removeRefusal, worktreeStatus } from '../services/repos'
import { activeCwds, isActiveWorktree } from '../utils'
import { sendJson } from '../http'

const CACHE_MS = 30_000
let cached: { at: number; body: Promise<unknown> } | null = null

export function invalidateInactiveCache(): void {
  cached = null
}

async function compute(): Promise<unknown> {
  const state = await collectState()
  const active = activeCwds(state)
  const inactive = state.repos.flatMap((repo) =>
    repo.worktrees.filter((wt) => !wt.isMain && !isActiveWorktree(wt.path, active)).map((wt) => ({ repo: repo.name, wt }))
  )
  const refusals = await Promise.all(inactive.map(({ wt }) => removeRefusal(wt.path, active)))
  const idle = inactive.filter((_, i) => !refusals[i])
  const worktrees = await Promise.all(
    idle.map(async ({ repo, wt }) => {
      const { status, unpushed } = await worktreeStatus(wt.path)
      return { path: wt.path, repo, branch: wt.branch, dirty: status, unpushed }
    })
  )
  const kept = inactive.flatMap(({ wt }, i) => (refusals[i] ? [{ path: wt.path, reason: refusals[i] as string }] : []))
  return { ok: true, worktrees, kept }
}

export async function handleInactiveWorktrees(res: ServerResponse): Promise<void> {
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    const body = compute()
    body.catch(() => {
      cached = null
    })
    cached = { at: Date.now(), body }
  }
  sendJson(res, await cached.body)
}
