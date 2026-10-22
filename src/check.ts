import assert from 'assert'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { activeCwds, isActiveWorktree, isUnder } from './utils'
import { downsample, summarise, type Snapshot } from './services/history'
import { tmuxKey, tmuxName } from './services/terminal'
import { keepReason, recentlyModified, type WorktreeFacts } from './services/repos'

assert.strictEqual(tmuxName('[hook:jira] Fix: a/b.c'), 'ad-hook-jira-Fix-a-b-c')
assert.strictEqual(tmuxName('x', ['ad-x', 'ad-x-2']), 'ad-x-3', 'collision gets a suffix')
assert.strictEqual(tmuxName('///'), 'ad-session')
assert.ok(/^[A-Za-z0-9._-]+$/.test(tmuxName('we ird;"$(x)')))
assert.strictEqual(tmuxKey('escape'), 'Escape')
assert.strictEqual(tmuxKey('enter'), 'Enter')

const wt = path.join(os.homedir(), 'Code', 'repo-worktrees', 'fix-a')
const active = (...cwds: string[]) => activeCwds({ tabs: cwds.map((cwd) => ({ ref: 't', cwd, title: '', lastActive: null })), agents: [] })

assert.ok(isActiveWorktree(wt, active(wt)))
assert.ok(isActiveWorktree(wt, active(`${wt}/web`)), 'subdirectory session keeps worktree active')
assert.ok(isActiveWorktree(wt, active(wt.replace('/Code/', '/code/'))), 'case difference still matches')
assert.ok(isActiveWorktree(`${wt}/`, active(wt)), 'trailing slash ignored')
assert.ok(!isActiveWorktree(wt, active(`${wt}-ii`)), 'sibling with shared prefix is not active')
assert.ok(!isActiveWorktree(wt, active(path.dirname(wt))), 'parent dir session is not active')
assert.ok(!isActiveWorktree(wt, active('')))
assert.ok(!isUnder('/a/bc', '/a/b'))
const facts = (over: Partial<WorktreeFacts> = {}): WorktreeFacts => ({
  isMain: false, active: false, editedLastHour: false, prDone: false, branchMerged: false, editedInIdleWindow: false, ...over
})
assert.strictEqual(keepReason(facts()), undefined, 'idle with no PR is inactive')
assert.strictEqual(keepReason(facts({ active: true, prDone: true })), 'active session', 'open cmux tab wins over a merged PR')
assert.strictEqual(keepReason(facts({ openPr: 7, editedInIdleWindow: false })), 'open PR #7', 'open PR keeps an idle worktree')
assert.strictEqual(keepReason(facts({ editedInIdleWindow: true })), 'files changed in the last 5 days', 'recent edits keep a no-PR worktree')
assert.strictEqual(keepReason(facts({ prDone: true, editedInIdleWindow: true })), undefined, 'merged or closed PR is inactive despite edits')
assert.strictEqual(keepReason(facts({ branchMerged: true, editedInIdleWindow: true })), undefined, 'merged branch is inactive despite edits')
assert.ok(keepReason(facts({ prDone: true, editedLastHour: true })), 'edits in the last hour still protect a subagent')
assert.strictEqual(keepReason(facts({ isMain: true })), 'main worktree')
const nums = Array.from({ length: 1000 }, (_, i) => i)
const sampled = downsample(nums, 300)
assert.strictEqual(sampled.length, 300)
assert.strictEqual(sampled[299], 999, 'newest point survives downsampling')
assert.deepStrictEqual(downsample([1, 2, 3], 300), [1, 2, 3], 'short series is untouched')
const snap = (ts: number, refs: string[]): Snapshot => ({
  ts: new Date(ts),
  repoCount: 1,
  worktreeCount: 4,
  tabs: refs.map((ref) => ({ ref, cwd: `/r/${ref}`, title: ref, branch: 'tech/x' })),
  agents: []
})
const summary = summarise([snap(1000, ['a']), snap(2000, ['b'])])
assert.deepStrictEqual(summary.timeline.map((p) => [p.tabs, p.agents, p.worktrees]), [[1, 0, 4], [1, 0, 4]], 'timeline carries counts only')
assert.strictEqual(summary.sessions.length, 2)
assert.strictEqual(summary.sessions[0].ref, 'b', 'most recently seen session first')
console.log('check: ok')

void (async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recent-'))
  const old = new Date(Date.now() - 2 * 3600_000)
  const file = (rel: string, mtime?: Date) => {
    const f = path.join(dir, rel)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, 'x')
    if (mtime) fs.utimesSync(f, mtime, mtime)
  }
  file('src/a.ts', old)
  file('node_modules/pkg/index.js')
  file('.git/index')
  assert.strictEqual(await recentlyModified(dir), false, 'fresh files only in .git and node_modules are ignored')
  file('src/b.ts')
  assert.strictEqual(await recentlyModified(dir), true, 'a fresh source file marks it recent')
  fs.rmSync(dir, { recursive: true })
})()
