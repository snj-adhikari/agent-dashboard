import assert from 'assert'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { activeCwds, isActiveWorktree, isUnder } from './utils'
import { downsample, summarise, type Snapshot } from './services/history'
import { tmuxKey, tmuxName } from './services/terminal'
import { keepReason, recentlyModified, type WorktreeFacts } from './services/repos'
import { herdrOwnedPids } from './services/processes'
import { alertMessage, codenameOf, hcAgent, parseHcList, focusHerdrAgent, herdrEnv, ticketRef, colourOf, parseAgentList, parseHerdrError, parseHerdrRef, parseSessionList, statusAlerts, ticketOf, withWorktrees } from './services/herdr'
import { isPermanentTitle, sidePane } from './services/cmuxControl'
import { relaySeed } from './services/hooks/execute'
import { buildMermaid, mermaidText } from './services/mermaid'
import type { HerdrAgent } from './types'
import { houseOf } from './shared/house'
import { buildHouses } from './services/herdr'
import './learningCheck'

assert.deepStrictEqual(houseOf('Grille + APIG'), houseOf('grille + apig'), 'house is deterministic and case-insensitive')
assert.match(houseOf('Grille').house, /^House [A-Z][a-z]+ of Grille$/)
assert.match(houseOf('Grille + APIG').house, / of Grille and Apig$/)
assert.notStrictEqual(houseOf('Grille').colours[0], houseOf('Grille').colours[1], 'two distinct house colours')
{
  const agent = (name: string, codename: string, status: string): HerdrAgent => ({ session: 'grille', paneId: 'w1:p1', workspaceId: 'w1', tabId: 't1', agent: 'claude', status, title: '', cwd: '/', name, codename })
  const houses = buildHouses([agent('main-grille', 'ash', 'idle'), agent('mc-1', 'bond', 'working')], ['grille'], { grille: { display: 'Grille', workspaceId: 'ws1' } }) as Record<string, { house: string; warden: string; creatures: unknown[] }>
  assert.strictEqual(houses.grille.house, houseOf('Grille').house, 'server house matches the shared generator')
  assert.strictEqual(houses.grille.warden, 'ash')
  assert.deepStrictEqual(houses.grille.creatures, [{ name: 'mc-1', codename: 'bond', status: 'working' }])
}

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
const agentJson = JSON.stringify({ result: { type: 'agent_list', agents: [
  { agent: 'claude', agent_status: 'blocked', cwd: '/r', foreground_cwd: '/r/wt', name: 'mc-183-bond', pane_id: 'w1:p2', tab_id: 'w1:t2', workspace_id: 'w1', terminal_title: 'x', terminal_title_stripped: 'Fixing\nthe cast' },
  { agent: 'claude', agent_status: 'idle', cwd: '/r', pane_id: 'w1:p1', tab_id: 'w1:t1', workspace_id: 'w1', display_agent: 'turing', tokens: { codename: 'curie' } },
  { agent_status: 'idle' }
] } })
const parsed = parseAgentList(agentJson)
assert.strictEqual(parsed.length, 2, 'agents without a pane are dropped')
assert.deepStrictEqual([parsed[0].paneId, parsed[0].status, parsed[0].cwd, parsed[0].title, parsed[0].codename], ['w1:p2', 'blocked', '/r/wt', 'Fixing\nthe cast', 'bond'])
assert.strictEqual(parsed[1].codename, 'curie', 'reported codename token wins over the name')
assert.deepStrictEqual(parseAgentList('{"id":"cli:agent:list","error":{"code":"server_not_running","message":"no herdr server"}}'), [], 'server down lists nothing')
assert.deepStrictEqual(parseAgentList('not json'), [])
assert.strictEqual(parseHerdrError('{"error":{"code":"agent_blocked","message":"blocked"},"id":"x"}')?.code, 'agent_blocked')
assert.strictEqual(codenameOf('', 'sub-nova'), 'nova')
assert.strictEqual(codenameOf('', 'reviewer'), undefined)
assert.strictEqual(colourOf('bond', { b: { colour: '#ef4444' } }), '#ef4444')
assert.strictEqual(colourOf('zed', { b: { colour: '#ef4444' } }), '#64748b', 'unknown letter falls back to grey')
assert.strictEqual(colourOf('bond', { b: { colour: 'red;x' } }), '#64748b', 'only hex colours pass')
assert.deepStrictEqual(
  parseSessionList('name                 status   directory   socket\ndefault              stopped  /a  /a/s\ngrille               running  /b  /b/s\nBad Name             running  /c  /c/s\n'),
  ['grille']
)
assert.strictEqual(ticketOf(undefined, 'MC-183 · bond · fix'), 'MC-183')
assert.strictEqual(ticketOf('no ticket', 'FIX/MC-1032-I'), 'MC-1032')
assert.strictEqual(ticketOf('mc-1 lower'), undefined)
const herdrAgent = (over: Partial<HerdrAgent> = {}): HerdrAgent => ({
  session: 'grille', paneId: 'w1:p2', workspaceId: 'w1', tabId: 'w1:t2', agent: 'claude', status: 'working', title: 't', cwd: '/nope', ...over
})
const joined = withWorktrees([herdrAgent({ cwd: os.tmpdir(), tabTitle: 'plain' })], [
  { path: '/r', name: 'r', worktrees: [{ path: os.tmpdir(), branch: 'fix/mc-77', changedFiles: 3 }] }
])
assert.deepStrictEqual([joined[0].changedFiles, joined[0].ticket], [3, 'MC-77'], 'worktree and ticket come from the branch')
assert.deepStrictEqual(
  [...herdrOwnedPids('  101 /bin/claude PATH=/x HERDR_PANE_ID=w1:p1 TERM=x\n  102 /bin/claude PATH=/x\n  103 claude HERDR_PANE_ID=\n')],
  ['101'],
  'only pids with a pane id in env are herdr-owned'
)
assert.deepStrictEqual([...herdrOwnedPids('  201 claude HC_TERMINAL_ID=t7 TERM=x\n  202 claude HC_TERMINAL_ID=\n')], ['201'], 'Herdr app terminals are owned')
const hcList = parseHcList(JSON.stringify({ terminals: [
  { address: 't4', agent: 'claude-code', cwd: '/d', state: 'live', status: 'idle', where: 'Drive / Claude Code' },
  { address: 't7', agent: 'claude-code', cwd: '/w', state: 'live', status: 'working', name: 'mc-1-bond' },
  { address: 't9', agent: 'zsh', cwd: '/x', state: 'live' },
  { address: 't2', agent: 'env', cwd: '/x', state: 'finished', status: 'done' }
] }))
assert.deepStrictEqual(hcList.map((t) => t.address), ['t4', 't7'], 'only live agent terminals are listed')
const handRun = parseHcList(JSON.stringify({ terminals: [{ address: 't13', agent: 'codex', cwd: '/w', state: 'live' }, { address: 't11', agent: 'sh', cwd: '/', state: 'live' }] }))
assert.deepStrictEqual(handRun.map((t) => [t.address, t.status]), [['t13', 'unknown']], 'a hand-run agent with no status report still counts')
assert.strictEqual(hcAgent(hcList[0], { labels: { codename: 'kepler' } }, {}).codename, 'kepler', 'the recorded codename label wins')
assert.deepStrictEqual(parseHcList('not json'), [])
const hcBond = hcAgent(hcList[1], { labels: { agent: 'bond', ticket: 'MC-1', 'herdr.space': 'sp1', 'herdr.tab': 'snj-mc-1-bond' }, foreground: { cwd: '/w/sub' } }, { b: { colour: '#ef4444' } })
assert.deepStrictEqual(
  [hcBond.session, hcBond.host, hcBond.codename, hcBond.colour, hcBond.ticket, hcBond.cwd, hcBond.workspaceId, hcBond.status],
  ['hc', 'herdr-app', 'bond', '#ef4444', 'MC-1', '/w/sub', 'sp1', 'working'],
  'hc terminals become herdr-app agents in session hc'
)
assert.strictEqual(hcAgent(hcList[0], {}, {}).tabTitle, 'Drive / Claude Code')
const prev = new Map([['grille/w1:p2', 'working'], ['grille/w1:p3', 'working']])
const { alerts, next } = statusAlerts(prev, [
  herdrAgent({ status: 'blocked', ticket: 'MC-1', codename: 'bond', title: 'a\nlast line' }),
  herdrAgent({ paneId: 'w1:p3', status: 'done', name: 'main-grille' }),
  herdrAgent({ paneId: 'w1:p4', status: 'done' })
])
assert.deepStrictEqual(alerts.map((a) => a.paneId), ['w1:p2'], 'controller and first sightings never alert')
assert.strictEqual(next.get('grille/w1:p4'), 'done')
assert.strictEqual(alertMessage(alerts[0]), '[monitor] MC-1 bond: blocked — last line')
assert.deepStrictEqual(parseHerdrRef('herdr:grille:w1:p2'), { session: 'grille', paneId: 'w1:p2' })
assert.strictEqual(parseHerdrRef('workspace:3'), null)
assert.strictEqual(ticketRef({ mode: 'herdr', session: 'grille', items: [{ pane: 'w2:p1' }] }), 'herdr:grille:w2:p1')
assert.strictEqual(ticketRef({ mode: 'cmux', items: [{ workspace: 'workspace:9' }] }), 'workspace:9')
assert.ok(isPermanentTitle('Drive - PR Review') && isPermanentTitle('Drive - Generic '))
assert.ok(!isPermanentTitle('Ticket - MC-1'))
const repoWithWt = { path: '/r', name: 'r', worktrees: [{ path: '/r', isMain: true }, { path: '/r/wt', branch: 'fix/mc-1' }] }
const graph = buildMermaid({ repos: [repoWithWt], tabs: [], agents: [], herdr: [herdrAgent({ cwd: '/r/wt', codename: 'bond', colour: '#ef4444', worktree: '/r/wt' })] })
assert.ok(graph.includes('subgraph herdr_grille') && graph.includes('herdr_grille_w1_p2') && graph.includes('style herdr_grille_w1_p2 stroke:#ef4444'))
assert.ok(graph.includes('wt__r_wt -.-> herdr_grille_w1_p2'), 'linked to its rendered worktree')
const orphan = buildMermaid({ repos: [], tabs: [], agents: [], herdr: [herdrAgent({ worktree: '/gone', colour: 'red;x' })] })
assert.ok(!orphan.includes('wt__gone') && !orphan.includes('style herdr'), 'no edge to an unrendered worktree, no unsafe style')
assert.strictEqual(mermaidText('a<b>&"c"\nd'), 'a#lt;b#gt;#amp;c d')
assert.strictEqual(relaySeed('/factory --brief x'), '/factory --brief x', 'slash-command seeds stay untagged')
assert.strictEqual(relaySeed('Fix it'), '[relay agent-monitor] Fix it')
const env = herdrEnv({ PATH: '/bin', HERDR_PANE_ID: 'w1:p1', HERDR_SOCKET_PATH: '/s', HERDR_ENV: '1', HERDR_SESSION: 'other' }, 'grille')
assert.deepStrictEqual(env, { PATH: '/bin', HERDR_SESSION: 'grille' }, 'inherited pane vars are stripped')
assert.strictEqual(sidePane([{ ref: 'pane:1', pixel_frame: { x: 0 } }]), undefined, 'one pane means split first')
assert.strictEqual(sidePane([{ ref: 'pane:1', pixel_frame: { x: 0 } }, { ref: 'pane:2', pixel_frame: { x: 500 } }, { ref: 'pane:3', pixel_frame: { x: 900 } }]), 'pane:3')
void assert.rejects(focusHerdrAgent('grille', 'w1:p1'), /invalid/, 'focus needs an agent name, not a pane id')
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
