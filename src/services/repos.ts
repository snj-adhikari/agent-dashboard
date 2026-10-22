import { execFile, exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import { isActiveWorktree, normPath, watchDirs } from '../utils'
import type { Repo, Worktree } from '../types'

const execFileAsync = promisify(execFile)
const execAsync = promisify(exec)

async function sh(cmd: string, cwd?: string): Promise<string> {
  try {
    const { stdout } = await execAsync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, cwd })
    return stdout
  } catch {
    return ''
  }
}

function findRepoDirs(): string[] {
  const repos: string[] = []
  const seenReal = new Set<string>()
  for (const base of watchDirs()) {
    if (!fs.existsSync(base)) continue
    for (const name of fs.readdirSync(base)) {
      const p = path.join(base, name)
      if (!fs.existsSync(path.join(p, '.git'))) continue
      const { dev, ino } = fs.statSync(p)
      const key = `${dev}:${ino}`
      if (seenReal.has(key)) continue
      seenReal.add(key)
      repos.push(p)
    }
  }
  return repos
}

async function worktreesFor(repo: string): Promise<Worktree[]> {
  const out = await sh(`git -C "${repo}" worktree list --porcelain`)
  const worktrees: Worktree[] = []
  let cur: Worktree = { path: '' }
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) cur = { path: line.slice(9), isMain: !cur.path }
    if (line.startsWith('branch ')) {
      cur.branch = line.slice(7).replace('refs/heads/', '')
      worktrees.push(cur)
    }
  }
  return worktrees
}

async function changedFileCount(worktreePath: string): Promise<number> {
  const out = await sh(`git -C "${worktreePath}" status --porcelain`)
  return out ? out.trim().split('\n').length : 0
}

export async function findRepos(activeCwds: Set<string> = new Set()): Promise<Repo[]> {
  return Promise.all(
    findRepoDirs().map(async (repo) => {
      const worktrees = await worktreesFor(repo)
      const enriched = await Promise.all(
        worktrees.map(async (wt) => ({
          ...wt,
          changedFiles: await changedFileCount(wt.path),
          pr: isActiveWorktree(wt.path, activeCwds) ? await prForBranch(wt.path, wt.branch) : undefined
        }))
      )
      return { path: repo, name: path.basename(repo), worktrees: enriched }
    })
  )
}

const prCache = new Map<string, { pr: Worktree['pr']; ts: number }>()
const PR_CACHE_MS = 60_000

async function prForBranch(worktreePath: string, branch: string | undefined): Promise<Worktree['pr']> {
  if (!branch) return undefined
  const cached = prCache.get(worktreePath)
  if (cached && Date.now() - cached.ts < PR_CACHE_MS) return cached.pr

  let pr: Worktree['pr']
  try {
    const { stdout } = await execFileAsync('gh', ['pr', 'list', '--head', branch, '--json', 'number,url,state', '--limit', '1'], {
      cwd: worktreePath,
      encoding: 'utf8'
    })
    const parsed = JSON.parse(stdout || '[]')
    if (parsed[0]) pr = { number: parsed[0].number, url: parsed[0].url, state: parsed[0].state }
  } catch {
    pr = undefined
  }
  prCache.set(worktreePath, { pr, ts: Date.now() })
  return pr
}

export async function removeWorktree(worktreePath: string, force = false): Promise<void> {
  try {
    const args = ['-C', worktreePath, 'worktree', 'remove']
    if (force) args.push('--force')
    args.push(worktreePath)
    await execFileAsync('git', args)
  } catch (e) {
    const err = e as { stderr?: string }
    if (force && /is locked/.test(err.stderr || '')) {
      await execFileAsync('git', ['-C', worktreePath, 'worktree', 'remove', '--force', '--force', worktreePath])
      return
    }
    throw e
  }
}

export async function worktreeStatus(worktreePath: string): Promise<{ status: string; unpushed: string }> {
  const status = await sh(`git -C "${worktreePath}" status --porcelain`)
  const branch = (await sh(`git -C "${worktreePath}" branch --show-current`)).trim()
  const unpushed = branch ? await sh(`git -C "${worktreePath}" log --oneline @{u}..HEAD`) : ''
  return { status: status.trim(), unpushed: unpushed.trim() }
}

export interface RemoveResult {
  path: string
  ok: boolean
  error?: string
}

export const RECENT_EDIT_MINUTES = 60
export const IDLE_DAYS = 5

/** True if any file outside .git and node_modules changed recently, which marks a worktree a subagent may still be using. */
export async function recentlyModified(worktreePath: string, minutes = RECENT_EDIT_MINUTES): Promise<boolean> {
  const args = [worktreePath, '(', '-name', '.git', '-o', '-name', 'node_modules', ')', '-prune', '-o', '-type', 'f', '-mmin', `-${minutes}`, '-print', '-quit']
  const { stdout } = await execFileAsync('find', args).catch(() => ({ stdout: '' }))
  return stdout.trim() !== ''
}

export interface WorktreeFacts {
  isMain: boolean
  active: boolean
  openPr?: number
  editedLastHour: boolean
  prDone: boolean
  branchMerged: boolean
  editedInIdleWindow: boolean
}

export function keepReason(f: WorktreeFacts): string | undefined {
  if (f.isMain) return 'main worktree'
  if (f.active) return 'active session'
  if (f.openPr) return `open PR #${f.openPr}`
  if (f.editedLastHour) return `files changed in the last ${RECENT_EDIT_MINUTES} minutes`
  if (f.prDone || f.branchMerged) return undefined
  if (f.editedInIdleWindow) return `files changed in the last ${IDLE_DAYS} days`
}

type PrState = { number: number; state: 'OPEN' | 'CLOSED' | 'MERGED' }
const prStatesCache = new Map<string, { prs: PrState[] | undefined; ts: number }>()

async function prStates(worktreePath: string, branch: string): Promise<PrState[] | undefined> {
  const key = `${worktreePath}:${branch}`
  const cached = prStatesCache.get(key)
  if (cached && Date.now() - cached.ts < PR_CACHE_MS) return cached.prs
  let prs: PrState[] | undefined
  try {
    const { stdout } = await execFileAsync('gh', ['pr', 'list', '--head', branch, '--state', 'all', '--json', 'number,state', '--limit', '10'], {
      cwd: worktreePath,
      encoding: 'utf8'
    })
    prs = JSON.parse(stdout || '[]')
  } catch {
    prs = undefined
  }
  prStatesCache.set(key, { prs, ts: Date.now() })
  return prs
}

async function gitOut(worktreePath: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', worktreePath, ...args]).catch(() => ({ stdout: '' }))
  return stdout.trim()
}

/** Strictly behind the default branch, so a fresh branch cut from it does not count as merged. */
async function branchMergedIntoDefault(worktreePath: string): Promise<boolean> {
  const base = (await gitOut(worktreePath, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')) || 'origin/main'
  const [head, tip] = await Promise.all([gitOut(worktreePath, 'rev-parse', 'HEAD'), gitOut(worktreePath, 'rev-parse', base)])
  if (!head || !tip || head === tip) return false
  return execFileAsync('git', ['-C', worktreePath, 'merge-base', '--is-ancestor', head, tip]).then(() => true, () => false)
}

export async function removeRefusal(worktreePath: string, active: Set<string>): Promise<string | undefined> {
  const { stdout } = await execFileAsync('git', ['-C', worktreePath, 'worktree', 'list', '--porcelain']).catch(() => ({ stdout: '' }))
  const main = stdout.split('\n')[0]
  const base = { isMain: main.startsWith('worktree ') && normPath(main.slice(9)) === normPath(worktreePath), active: isActiveWorktree(worktreePath, active) }
  if (base.isMain || base.active) return keepReason({ ...base, editedLastHour: false, prDone: false, branchMerged: false, editedInIdleWindow: false })
  const branch = await gitOut(worktreePath, 'branch', '--show-current')
  const [prs, editedLastHour, editedInIdleWindow, branchMerged] = await Promise.all([
    branch ? prStates(worktreePath, branch) : undefined,
    recentlyModified(worktreePath),
    recentlyModified(worktreePath, IDLE_DAYS * 24 * 60),
    branchMergedIntoDefault(worktreePath)
  ])
  return keepReason({
    ...base,
    openPr: prs?.find((p) => p.state === 'OPEN')?.number,
    editedLastHour,
    prDone: !!prs?.some((p) => p.state !== 'OPEN'),
    branchMerged,
    editedInIdleWindow
  })
}

export async function removeWorktrees(worktreePaths: string[], force: boolean, active: Set<string>): Promise<RemoveResult[]> {
  return Promise.all(
    worktreePaths.map(async (worktreePath) => {
      const refusal = await removeRefusal(worktreePath, active)
      if (refusal) return { path: worktreePath, ok: false, error: refusal }
      try {
        await removeWorktree(worktreePath, force)
        return { path: worktreePath, ok: true }
      } catch (e) {
        const err = e as { stderr?: string; message?: string }
        return { path: worktreePath, ok: false, error: (err.stderr || err.message || '').toString().trim() }
      }
    })
  )
}
