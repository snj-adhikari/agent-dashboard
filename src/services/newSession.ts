import { execFileSync } from 'child_process'
import path from 'path'
import { openClaudeTab } from './cmuxControl'

export interface SessionOptions {
  tabName?: string
  base?: string
  prompt?: string
  env?: Record<string, string>
}

export function createWorktreeSession(repoPath: string, branch: string, opts: SessionOptions = {}): string {
  const repoName = path.basename(repoPath)
  const folderSlug = branch.replace(/\//g, '-')
  const target = path.join(repoPath, '..', `${repoName}-worktrees`, folderSlug)

  const baseArgs = opts.base ? ['--no-track', target, opts.base] : [target]
  execFileSync('git', ['-C', repoPath, 'worktree', 'add', '-b', branch, ...baseArgs], { encoding: 'utf8' })

  return openClaudeTab(opts.tabName || branch, target, opts.prompt, opts.env)
}
