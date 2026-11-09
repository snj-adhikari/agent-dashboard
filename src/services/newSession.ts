import { execFile, execFileSync } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { openClaudeTab } from './terminal'
import { SNJ_TERM, ticketOf, ticketRef } from './herdr'

export interface SessionOptions {
  tabName?: string
  base?: string
  prompt?: string
  env?: Record<string, string>
}

export function worktreePathFor(repoPath: string, branch: string): string {
  return path.join(repoPath, '..', `${path.basename(repoPath)}-worktrees`, branch.replace(/\//g, '-'))
}

export function createWorktreeSession(repoPath: string, branch: string, opts: SessionOptions = {}): string {
  const target = worktreePathFor(repoPath, branch)

  const baseArgs = opts.base ? ['--no-track', target, opts.base] : [target]
  execFileSync('git', ['-C', repoPath, 'worktree', 'add', '-b', branch, ...baseArgs], { encoding: 'utf8' })

  return openClaudeTab(opts.tabName || branch, target, opts.prompt, opts.env)
}

/** Opens the branch as a tab in the repo's herdr project pane; snj-term falls back to cmux itself. Needs a ticket key in the branch. */
export async function createHerdrTicketSession(repoPath: string, branch: string): Promise<{ mode: string; ref?: string } | null> {
  const key = ticketOf(branch.toUpperCase())
  if (!key) return null
  const task = branch.replace(/^[^/]+\//, '')
  let stdout: string
  try {
    stdout = (await promisify(execFile)(SNJ_TERM, ['ticket', '--repos', `${repoPath}:${branch}`, '--key', key, '--task', task], { timeout: 180_000 })).stdout
  } catch (e) {
    let reason = ''
    try {
      reason = JSON.parse(String((e as { stdout?: string }).stdout)).error
    } catch {}
    throw new Error(reason || (e as Error).message)
  }
  const out = JSON.parse(stdout)
  return { mode: String(out.mode || ''), ref: ticketRef(out) }
}
