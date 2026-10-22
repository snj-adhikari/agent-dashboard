import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x']

function branchExists(repoPath: string, branch: string): boolean {
  try {
    execFileSync('git', ['-C', repoPath, 'rev-parse', '--verify', `refs/heads/${branch}`], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function folderExists(repoPath: string, branch: string): boolean {
  const repoName = path.basename(repoPath)
  const target = path.join(repoPath, '..', `${repoName}-worktrees`, branch.replace(/\//g, '-'))
  return fs.existsSync(target)
}

// Per CLAUDE.md: bare ticket-id branch, suffix -i/-ii/... on collision (never reset/reuse).
export function resolveBranchName(repoPath: string, branch: string): string {
  if (!branchExists(repoPath, branch) && !folderExists(repoPath, branch)) return branch
  for (const suffix of ROMAN) {
    const candidate = `${branch}-${suffix}`
    if (!branchExists(repoPath, candidate) && !folderExists(repoPath, candidate)) return candidate
  }
  throw new Error(`could not find a free branch name for ${branch}`)
}
