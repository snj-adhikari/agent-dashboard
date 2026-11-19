import assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Readable } from 'stream'
import type { IncomingMessage, ServerResponse } from 'http'
import { ensureToken, requireToken } from './services/cuckoo/token'
import { relayKey, textHash } from './services/cuckoo/relayLog'
import { io, polledAgents, rememberAgents, sendKeys, typeText } from './services/cuckoo/keys'
import { approvalsFor, parseDialog } from './services/cuckoo/promptParse'
import { parseReplies, repliesFor } from './services/cuckoo/replyParse'
import { decisionKey, handleCuckooAction, isGitGrant, launchCommand } from './routes/cuckooActions'
import type { Agent } from './services/cuckoo/agents'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-check-'))
process.env.CUCKOO_RELAY_DIR = path.join(tmp, 'relays')
process.env.CUCKOO_TOKEN_PATH = path.join(tmp, 'cfg', 'token')
process.env.CUCKOO_LAUNCH_DIR = tmp

const calls: { cmd: string; args: string[]; relayLines: number }[] = []
let screen = ''
const relayLines = (): number => {
  try {
    return fs.readdirSync(process.env.CUCKOO_RELAY_DIR as string).reduce((n, f) => n + fs.readFileSync(path.join(process.env.CUCKOO_RELAY_DIR as string, f), 'utf8').split('\n').filter(Boolean).length, 0)
  } catch {
    return 0
  }
}
io.run = async (cmd, args) => {
  calls.push({ cmd: path.basename(cmd), args, relayLines: relayLines() })
  return /read|capture-pane|read-screen/.test(args.join(' ')) ? screen : ''
}
io.fresh = async () => polledAgents()
const launched: { name: string; cwd: string; command: string }[] = []
io.openTab = (name, cwd, command) => {
  launched.push({ name, cwd, command })
  return 'workspace:9'
}

const agent = (over: Partial<Agent>): Agent => ({ id: 'herdr:main:w1:p2', name: 'agent-monitor', codename: 'eon', colour: null, state: 'working', host: 'herdr', terminalApp: null, scope: null, space: 'Drive', isMain: true, cwd: '/', branch: null, lastLine: null, cli: 'claude', canSend: true, ...over })
const herdrA = agent({})
const hcA = agent({ id: 'herdr-app:hc:t3k', host: 'herdr-app', codename: 'ash' })
const cmuxA = agent({ id: 'cmux:workspace:4:surface:7', host: 'cmux', codename: 'bond' })
const tmuxA = agent({ id: 'tmux:ad-x:', host: 'tmux', codename: 'cy' })
const bareA = agent({ id: 'bare:local:4242', host: 'bare', codename: null, canSend: false })

const DIALOG3 = `⏺ Running checks
╭───────────────────────────────────────────╮
│ Bash command                              │
│                                           │
│   npm run check                           │
│   Run the repo checks                     │
│                                           │
│ Do you want to proceed?                   │
│ ❯ 1. Yes                                  │
│   2. Yes, and don't ask again for npm run │
│   3. No, and tell Claude what to do differently (esc) │
╰───────────────────────────────────────────╯`
const DIALOG2 = ` Bash command

   git push origin tech/overseer
   Push the branch

 Do you want to proceed?
 ❯ 1. Yes
   2. No, and tell Claude what to do differently (esc)`
const NONE = `⏺ Reading src/index.ts\n  ⎿  Read 120 lines\n\n> `

function fakeReq(body: unknown, token: string | null, method = 'POST'): IncomingMessage {
  const r = Readable.from([JSON.stringify(body)]) as unknown as IncomingMessage
  r.method = method
  r.headers = token ? { authorization: `Bearer ${token}` } : {}
  return r
}
function fakeRes(): ServerResponse & { status: number; body: Record<string, unknown> } {
  const res = { status: 0, body: {} as Record<string, unknown>, writeHead(s: number) { res.status = s; return res }, end(b: string) { res.body = JSON.parse(b) } }
  return res as unknown as ServerResponse & { status: number; body: Record<string, unknown> }
}
async function call(action: string, body: unknown, token: string | null = ensureToken()) {
  const res = fakeRes()
  const handled = await handleCuckooAction(fakeReq(body, token), res, new URL(`http://127.0.0.1:5818/api/v1/cuckoo/${action}`))
  return { handled, ...res }
}

async function main(): Promise<void> {
  const token = ensureToken()
  assert.match(token, /^[0-9a-f]{64}$/)
  assert.strictEqual(fs.statSync(process.env.CUCKOO_TOKEN_PATH as string).mode & 0o777, 0o600, 'token file is 0600')
  assert.strictEqual(ensureToken(), token, 'token is stable')
  assert.ok(requireToken(fakeReq({}, token), fakeRes()))
  const bad = fakeRes()
  assert.ok(!requireToken(fakeReq({}, 'nope'), bad))
  assert.strictEqual(bad.status, 401)
  assert.strictEqual((await call('say', {}, null)).status, 401, 'actions need the token')
  assert.strictEqual((await call('graph', {})).handled, false, 'other paths fall through')
  assert.strictEqual((await call('toString', {})).handled, false, 'prototype keys are not actions')

  assert.strictEqual(relayKey(herdrA), 'main-w1:p2')
  assert.strictEqual(relayKey(hcA), 't3k')
  assert.strictEqual(relayKey(cmuxA), 'surface:7')
  assert.strictEqual(relayKey(tmuxA), 'ad-x')
  assert.throws(() => relayKey(bareA), /cannot send/)
  assert.strictEqual(textHash('  a\n  b '), textHash('a b'), 'hash is whitespace-collapsed and trimmed')

  calls.length = 0
  for (const a of [herdrA, hcA, cmuxA, tmuxA]) await typeText(a, 'hi there')
  assert.deepStrictEqual(calls.map((c) => [c.cmd, ...c.args]), [
    ['herdr', 'agent', 'prompt', 'w1:p2', 'hi there'],
    ['hc', 'send', 't3k', 'hi there'],
    ['cmux', 'send', '--workspace', 'workspace:4', '--surface', 'surface:7', 'hi there\n'],
    ['tmux', 'send-keys', '-t', 'ad-x', '-l', 'hi there'],
    ['tmux', 'send-keys', '-t', 'ad-x', 'Enter']
  ])
  calls.length = 0
  for (const a of [herdrA, hcA, cmuxA, tmuxA]) await sendKeys(a, ['Escape'])
  assert.deepStrictEqual(calls.map((c) => [c.cmd, ...c.args]), [
    ['herdr', 'agent', 'send-keys', 'w1:p2', 'Escape'],
    ['hc', 'keys', 't3k', 'escape'],
    ['cmux', 'send-key', '--workspace', 'workspace:4', 'escape'],
    ['tmux', 'send-keys', '-t', 'ad-x', 'Escape']
  ])
  await assert.rejects(typeText(bareA, 'x'), /cannot send/)

  const d3 = parseDialog(DIALOG3)
  assert.ok(d3)
  assert.strictEqual(d3.tool, 'Bash')
  assert.strictEqual(d3.command, 'npm run check')
  assert.deepStrictEqual(d3.options.map((o) => o.key), ['1', '2', '3'])
  assert.strictEqual(d3.options[2].label, 'No, and tell Claude what to do differently')
  const d2 = parseDialog(DIALOG2)
  assert.ok(d2)
  assert.strictEqual(d2.command, 'git push origin tech/overseer')
  assert.strictEqual(d2.options.length, 2)
  assert.strictEqual(parseDialog(NONE), null)
  assert.strictEqual(parseDialog('⏺ eon needs your approval to merge PR #86')?.tool, 'ask')

  assert.strictEqual(decisionKey('allow', 3), '1')
  assert.strictEqual(decisionKey('always', 3), '2')
  assert.strictEqual(decisionKey('deny', 2), 'Escape')
  assert.throws(() => decisionKey('always', 2), /not available/)
  assert.throws(() => decisionKey('yes', 3), /not available/)

  const reply = `⏺ eon here: done, PR #86 open and the checks\n  are green\n\n> next\n⏺ eon here: done, PR #86 open and the checks are green\n⏺ Bash(ls)`
  assert.deepStrictEqual(parseReplies(reply, 'eon'), ['done, PR #86 open and the checks are green', 'done, PR #86 open and the checks are green'])
  assert.deepStrictEqual(parseReplies('> eon here: typed by me', 'eon'), [], 'the prompt line is not a reply')

  rememberAgents([herdrA, hcA, cmuxA, tmuxA, bareA])
  const relayFile = path.join(process.env.CUCKOO_RELAY_DIR as string, 'main-w1:p2.jsonl')
  calls.length = 0
  const said = await call('say', { agentId: herdrA.id, text: '  check   the\nbuild ' })
  assert.strictEqual(said.status, 200, JSON.stringify(said.body))
  assert.deepStrictEqual(said.body, { ok: true, relayKey: 'main-w1:p2', sha256: textHash('check the build') })
  const line = JSON.parse(fs.readFileSync(relayFile, 'utf8').trim().split('\n').pop() as string)
  assert.strictEqual(line.main, true)
  assert.strictEqual(line.sha256, textHash('check the build'))
  assert.strictEqual(fs.statSync(relayFile).mode & 0o777, 0o600)
  assert.strictEqual(calls.length, 1)
  assert.deepStrictEqual(calls[0].args, ['agent', 'prompt', 'w1:p2', 'check the build'], 'types the hashed text')
  assert.strictEqual(calls[0].relayLines, 1, 'relay line written before typing')

  screen = `⏺ eon here: done, PR #86 open\n`
  assert.deepStrictEqual((await repliesFor([herdrA])).map((r) => r.text), ['done, PR #86 open'])
  assert.strictEqual((await repliesFor([herdrA])).length, 1, 'replies de-duplicate')
  assert.deepStrictEqual(await repliesFor([hcA]), [], 'only agents sent to are read')

  rememberAgents([herdrA, hcA, cmuxA, tmuxA, bareA])
  const before = relayLines()
  calls.length = 0
  const freshDefault = io.fresh
  io.fresh = async () => [{ ...herdrA, codename: 'zed' }]
  const stale = await call('say', { agentId: herdrA.id, text: 'hello' })
  assert.strictEqual(stale.status, 409)
  assert.strictEqual(stale.body.error, 'stale')
  io.fresh = async () => []
  assert.strictEqual((await call('say', { agentId: herdrA.id, text: 'hello' })).status, 409, 'gone agent is stale')
  assert.strictEqual(relayLines(), before, 'stale writes nothing')
  assert.strictEqual(calls.length, 0, 'stale types nothing')
  io.fresh = freshDefault
  const bare = await call('say', { agentId: bareA.id, text: 'hi' })
  assert.deepStrictEqual([bare.status, bare.body.error], [422, 'cannot_send'])
  assert.strictEqual((await call('say', { agentId: 'herdr:x:w9:p9', text: 'hi' })).status, 404)
  assert.strictEqual((await call('say', { agentId: herdrA.id })).status, 400)

  const waitingA = { ...herdrA, state: 'waiting' as const }
  const waitingHc = { ...hcA, state: 'waiting' as const }
  screen = DIALOG3
  const [ap] = await approvalsFor([waitingA, hcA, bareA])
  assert.ok(ap, 'waiting agent with a dialog gives an approval')
  assert.deepStrictEqual([ap.tool, ap.command, ap.options.length, ap.agentId], ['Bash', 'npm run check', 3, herdrA.id])
  assert.match(ap.id, /^[0-9a-f]{16}$/)
  screen = DIALOG2
  assert.strictEqual((await call('approve', { id: ap.id, decision: 'allow' })).status, 409, 'changed screen is stale')
  screen = DIALOG3
  calls.length = 0
  const ok = await call('approve', { id: ap.id, decision: 'always' })
  assert.deepStrictEqual(ok.body, { ok: true, sent: '2' })
  const keyCall = calls.find((c) => c.args.includes('send-keys'))
  assert.ok(keyCall)
  assert.deepStrictEqual(keyCall.args, ['agent', 'send-keys', 'w1:p2', '2'])
  assert.ok(!calls.some((c) => c.args.join(' ').toLowerCase().includes('yes')), 'never types yes')
  assert.strictEqual(JSON.parse(fs.readFileSync(relayFile, 'utf8').trim().split('\n').pop() as string).sha256, textHash('2'), 'keystroke relay-logged')

  screen = DIALOG2
  const [push] = await approvalsFor([waitingA, waitingHc, bareA])
  const denied = await call('approve', { id: push.id, decision: 'allow' })
  assert.deepStrictEqual([denied.status, denied.body.error], [403, 'grant_in_terminal'])
  assert.strictEqual((await call('approve', { id: 'ffffffffffffffff', decision: 'allow' })).status, 409)

  for (const cmdText of ['git -C d push', 'git -c k=v commit -m x', 'cd x &&\n git push', 'git --no-pager -C /a/b push origin', 'npm test && git commit -am wip'])
    assert.ok(isGitGrant(cmdText), `grant: ${cmdText}`)
  for (const cmdText of ['git status', 'npm run push-docs', 'git log; echo commit']) assert.ok(!isGitGrant(cmdText), `not a grant: ${cmdText}`)
  screen = DIALOG2.replace('git push origin tech/overseer', 'cd /repo &&\n   git -C . push')
  const [hidden] = await approvalsFor([waitingA, bareA])
  assert.strictEqual(hidden.command, 'cd /repo &&', 'first line hides the git call')
  assert.strictEqual((await call('approve', { id: hidden.id, decision: 'allow' })).status, 403, 'whole dialog is checked')

  calls.length = 0
  for (const a of [herdrA, hcA, cmuxA, tmuxA]) await typeText(a, '--help')
  assert.deepStrictEqual(calls.filter((c) => !c.args.includes('Enter')).map((c) => c.args.find((x) => x.includes('--help'))), [' --help', ' --help', ' --help\n', ' --help'], 'dash text is never a flag')
  calls.length = 0
  await call('say', { agentId: herdrA.id, text: '--version' })
  assert.strictEqual(fs.readFileSync(relayFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l).sha256).pop(), textHash('--version'), 'guard space is not hashed')

  fs.chmodSync(process.env.CUCKOO_TOKEN_PATH as string, 0o644)
  ensureToken()
  assert.strictEqual(fs.statSync(process.env.CUCKOO_TOKEN_PATH as string).mode & 0o777, 0o600, 'existing token tightened to 0600')

  calls.length = 0
  assert.deepStrictEqual((await call('focus', { agentId: herdrA.id })).body, { ok: true, focused: true, via: 'herdr' })
  assert.deepStrictEqual(calls[0].args, ['agent', 'focus', 'w1:p2'])
  assert.deepStrictEqual((await call('focus', { agentId: bareA.id })).body, { ok: true, focused: false, via: null })

  const secret = 'ship it; rm -rf / $(whoami) "quoted"'
  const launchedRes = await call('launch', { cwd: tmp, prompt: secret, cli: 'claude' })
  assert.deepStrictEqual(launchedRes.body, { ok: true, ref: 'workspace:9' })
  const cmd = launched[0].command
  assert.ok(!cmd.includes('ship it') && !cmd.includes('whoami'), 'launch command never contains the prompt')
  assert.match(cmd, /^zsh -lc .*CUCKOO_PROMPT/)
  const promptFile = /cuckoo '([^']+)'$/.exec(cmd)?.[1] as string
  assert.strictEqual(fs.readFileSync(promptFile, 'utf8'), secret)
  assert.strictEqual(fs.statSync(promptFile).mode & 0o777, 0o600)
  assert.strictEqual(launchCommand('codex'), `zsh -lc 'exec codex'`)
  assert.strictEqual((await call('launch', { cwd: tmp, prompt: 'x', cli: 'bash' })).status, 400)
  assert.strictEqual((await call('launch', { cwd: 'relative', prompt: 'x', cli: 'claude' })).status, 400)

  await call('launch', { cwd: tmp, prompt: '--dangerously-skip-permissions', cli: 'claude' })
  const flagFile = /cuckoo '([^']+)'$/.exec(launched[launched.length - 1].command)?.[1] as string
  assert.strictEqual(fs.readFileSync(flagFile, 'utf8'), ' --dangerously-skip-permissions', 'launch prompt is always positional')

  const leftovers = (): string[] => fs.readdirSync(tmp).filter((f) => f.startsWith('cuckoo-launch-'))
  const already = leftovers().length
  io.openTab = () => {
    throw new Error('no terminal')
  }
  const failed = await call('launch', { cwd: tmp, prompt: 'secret', cli: 'claude' })
  assert.deepStrictEqual([failed.status, failed.body.error], [502, 'host_failed'])
  assert.strictEqual(leftovers().length, already, 'prompt file removed when openTab fails')

  fs.rmSync(tmp, { recursive: true, force: true })
  console.log('cuckooActionsCheck ok')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
