import assert from 'assert'
import { hostAppOf, parseProcTree, toAgents, type Agent } from './services/cuckoo/agents'
import { io } from './services/cuckoo/keys'
import { parseDialog } from './services/cuckoo/promptParse'
import { parseAsks, repliesFor } from './services/cuckoo/replyParse'
import type { LiveSession } from './services/hooks/sessions'
import { bareOf } from './services/processes'

let screen = ''
io.run = async (_cmd, args) => (/read|capture-pane|read-screen/.test(args.join(' ')) ? screen : '')

const PS = `    1     0 /sbin/launchd
  100     1 /Applications/cmux.app/Contents/MacOS/cmux
  101   100 -zsh
  102   101 /Users/x/.local/bin/claude
  200     1 /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal
  201   200 login
  202   201 -zsh
  203   202 codex
  300     1 /Users/x/.local/herdr-core/active/Herdr Core.app/Contents/MacOS/herdr-core
  301   300 /bin/zsh
  302   301 claude
  400     1 /Applications/iTerm.app/Contents/MacOS/iTerm2
  401   400 -zsh
  402   401 claude
  500     1 /Applications/Ghostty.app/Contents/MacOS/ghostty
  501   500 claude
  600     1 /Applications/Claude.app/Contents/MacOS/Claude
  601   600 /Applications/Claude.app/Contents/Helpers/disclaimer
  602   601 claude
  700     1 /usr/sbin/sshd
  701   700 claude
`

const session = (o: Partial<LiveSession>): LiveSession => ({ sessionId: 's', phase: 'working', pid: '', cwd: '', workspace: '', hook: '', ticket: '', branch: '', at: '2026-11-19T00:00:00.000Z', ...o })
const empty = { at: 1, ok: true, sessions: [], agents: [] }

async function main(): Promise<void> {
  const tree = parseProcTree(PS)
  assert.deepStrictEqual(['102', '203', '302', '402', '501', '602', '701', '999'].map((p) => hostAppOf(p, tree)), ['cmux', 'Terminal', 'Herdr', 'iTerm2', 'Ghostty', 'Claude', null, null], 'hostApp from the parent app bundle')

  {
    const procs = [
      { pid: '102', cmd: 'claude', cwd: '/w/repo' },
      { pid: '203', cmd: 'codex', cwd: '/tmp/outside-watch' }
    ]
    const sessions = [
      session({ sessionId: 'sess-102', pid: '102', cwd: '/w/repo', branch: 'feat/x', phase: 'blocked' }),
      session({ sessionId: 'sess-602', pid: '602', cwd: '/Users/x/scratch' }),
      session({ sessionId: 'sess-302', pid: '302', cwd: '/w/herdr-hosted' }),
      session({ sessionId: 'no-pid', cwd: '/w/repo' })
    ]
    const agents = toAgents(empty, [], procs, {}, 'cmux', {}, { sessions, tree })
    const byPid = Object.fromEntries(agents.map((a) => [a.pid, a]))
    assert.deepStrictEqual(agents.map((a) => a.id).sort(), ['bare:102:102', 'bare:203:203', 'bare:602:602'], 'toAgents merges live sessions: one agent per pid, herdr-hosted and pid-less sessions not duplicated')
    assert.deepStrictEqual([byPid[102].sessionId, byPid[102].branch, byPid[102].state, byPid[102].hostApp, byPid[102].lastActiveAt], ['sess-102', 'feat/x', 'waiting', 'cmux', Date.parse('2026-11-19T00:00:00.000Z')], 'toAgents merges live sessions: session fields onto the process')
    assert.ok(agents.every((a) => a.canSend === false && a.host === 'bare'), 'toAgents merges live sessions: bare stays canSend false')
    assert.deepStrictEqual([byPid[602].cli, byPid[602].hostApp, byPid[602].cwd, byPid[602].sessionId], ['claude', 'Claude', '/Users/x/scratch', 'sess-602'], 'bare outside watch dirs listed: hook session with no scanned process')
    assert.deepStrictEqual([byPid[203].cwd, byPid[203].hostApp, byPid[203].sessionId, byPid[203].lastActiveAt], ['/tmp/outside-watch', 'Terminal', null, null], 'bare outside watch dirs listed: toAgents does not filter by cwd')
  }

  {
    const scanned = [
      { pid: '203', cmd: 'codex', cwd: '/tmp/outside-watch', inHerdr: false },
      { pid: '402', cmd: 'gemini', cwd: '/Users/x/elsewhere', inHerdr: false },
      { pid: '501', cmd: 'opencode', cwd: '/w/repo', inHerdr: false },
      { pid: '302', cmd: 'cursor-agent', cwd: '/tmp/outside-watch', inHerdr: true }
    ]
    assert.deepStrictEqual(bareOf(scanned, ['/w']).map((p) => p.cmd), ['opencode'], 'bare outside watch dirs listed: agentProcesses keeps its watch-dir filter')
    const agents = toAgents(empty, [], bareOf(scanned), {}, 'cmux', {}, { sessions: [], tree })
    assert.deepStrictEqual(agents.map((a) => [a.cli, a.cwd, a.hostApp, a.canSend, a.sessionId]).sort(), [
      ['codex', '/tmp/outside-watch', 'Terminal', false, null],
      ['gemini', '/Users/x/elsewhere', 'iTerm2', false, null],
      ['opencode', '/w/repo', 'Ghostty', false, null]
    ], 'bare outside watch dirs listed: non-Claude CLIs without a hook, herdr-owned excluded')
  }

  {
    const herdr = { session: 'main', paneId: 'w1:p2', workspaceId: 'w1', agent: 'claude-code', status: 'working', cwd: '/x', name: 'eon', codename: 'eon', cmuxWorkspaceId: 'ws-1' }
    const app = { ...herdr, session: 'hc', paneId: 't1', cmuxWorkspaceId: undefined, host: 'herdr-app' }
    const tab = { ref: 'workspace:9', id: 'ws-9', cwd: '/y', title: 't', lastActive: null }
    const hosts = Object.fromEntries(toAgents({ ...empty, agents: [herdr, app] as never }, [tab], [], {}).map((a) => [a.id.split(':')[0], a.hostApp]))
    assert.deepStrictEqual(hosts, { herdr: 'cmux', 'herdr-app': 'Herdr', cmux: 'cmux' }, 'hostApp for herdr, Herdr app and cmux agents')
  }

  {
    const tail = ['> Hey eon, check the build', '⏺ eon here: on it', '> factory lead here: "add dark mode" ASK 1. Which theme?', '  a. system (Recommended)', '> bond needs your approval: commit on fix/mc-1', '> eon needs your approval: nope'].join('\n')
    assert.deepStrictEqual(parseAsks(tail, 'eon'), [
      { from: 'factory lead', text: '"add dark mode" ASK 1. Which theme? a. system (Recommended)' },
      { from: 'bond', text: 'commit on fix/mc-1' }
    ], 'replies ask kind: parse')
    screen = tail
    const main: Agent = { id: 'herdr:main:w1:p2', name: 'eon', codename: 'eon', colour: null, state: 'working', host: 'herdr', terminalApp: null, scope: 'herdr:main:w1', space: 's', isMain: true, cwd: '/x', branch: null, lastLine: null, cli: 'claude', canSend: true }
    const replies = await repliesFor([main])
    assert.deepStrictEqual(replies.map((r) => [r.kind, r.from, r.agentId]), [['ask', 'factory lead', main.id], ['ask', 'bond', main.id]], 'replies ask kind')
    assert.deepStrictEqual(await repliesFor([{ ...main, id: 'herdr:main:w1:p3', isMain: false }]), [], 'replies ask kind: only mains are read for asks')
    screen = ['> bond needs your approval: commit on fix/mc-2', '> factory lead here: "x" ASK 1. Pick a or b?'].join('\n')
    const waiting = { ...main, id: 'herdr:main:w1:p4', state: 'waiting' as const }
    assert.strictEqual(parseDialog(screen)?.command, '> bond needs your approval: commit on fix/mc-2', 'ask dedupe: the line is parsed as an approval')
    assert.deepStrictEqual((await repliesFor([waiting])).filter((r) => r.agentId === waiting.id).map((r) => r.from), ['factory lead'], 'ask dedupe: approval prompt not repeated as an ask')
    const idle = { ...main, id: 'herdr:main:w1:p5', state: 'working' as const }
    assert.deepStrictEqual((await repliesFor([idle])).filter((r) => r.agentId === idle.id).map((r) => r.from), ['bond', 'factory lead'], 'ask dedupe: kept when no approval is parsed')
  }

  {
    const plan = ["Here is Claude's plan:", '╭──────╮', '│ Ship the contract freeze │', '╰──────╯', 'Would you like to proceed?', '❯ 1. Yes, and auto-accept edits', '  2. Yes, and manually approve edits', '  3. No, keep planning'].join('\n')
    const d = parseDialog(plan)
    assert.deepStrictEqual([d?.kind, d?.tool, d?.command, d?.options.map((o) => o.key)], ['plan', 'ExitPlanMode', 'Ship the contract freeze', ['1', '2', '3']], 'approval plan kind')
    const question = ['☐ Library', '', 'Which library should we use?', '', '❯ 1. Zod', '     Schema validation', '  2. Valibot', '     Smaller bundle', '  3. Type something.', 'Enter to select · ↑/↓ to navigate · Esc to cancel'].join('\n')
    const q = parseDialog(question)
    assert.deepStrictEqual([q?.kind, q?.tool, q?.command, q?.options.map((o) => o.label)], ['question', 'AskUserQuestion', 'Which library should we use?', ['Zod', 'Valibot', 'Type something.']], 'approval question kind')
    const perm = parseDialog(['Bash command', 'npm test', 'Do you want to proceed?', '❯ 1. Yes', '  2. No'].join('\n'))
    assert.deepStrictEqual([perm?.kind, perm?.tool], ['permission', 'Bash'], 'approval permission kind')
    assert.strictEqual(parseDialog(plan + '\nBash command\nls\nDo you want to proceed?\n❯ 1. Yes\n  2. No')?.kind, 'permission', 'the later dialog wins')
  }
  console.log('cuckooSessionsCheck ok: toAgents merges live sessions, bare outside watch dirs listed, replies ask kind, ask dedupe, approval plan kind')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
