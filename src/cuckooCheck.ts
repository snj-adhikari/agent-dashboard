import assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { mapState, sortAgents, toAgents, BARE_SPACE, type Agent } from './services/cuckoo/agents'
import { claimKey, isMainFor, readClaims } from './services/cuckoo/mainClaims'
import { claudeUsage, readUsageFile, usageFile } from './services/cuckoo/usage'
import { overrideHookSettings } from './services/hooks/config'
import { isCuckooPath, pollSnapshot } from './routes/cuckoo'
import { addressOf, CuckooError } from './services/cuckoo/relayLog'
import { assertFresh, rememberAgents } from './services/cuckoo/keys'
import { hcAgent, type HerdrSnapshot } from './services/herdr'
import type { HerdrAgent } from './types'

const ROOT = path.join(__dirname, '..')
const CONTRACT = path.join(ROOT, 'apps', 'agent-cuckoo', 'contract')

type Schema = { type?: string | string[]; enum?: unknown[]; required?: string[]; properties?: Record<string, Schema>; items?: Schema; $ref?: string }

const typeOf = (v: unknown): string[] =>
  v === null ? ['null'] : Array.isArray(v) ? ['array'] : typeof v === 'number' ? (Number.isInteger(v) ? ['integer', 'number'] : ['number']) : [typeof v]

/** Walks the schema subset the contract uses (type, enum, required, properties, items, local $ref) and returns every mismatch. */
function validate(value: unknown, schema: Schema, root: Schema & { $defs?: Record<string, Schema> }, at = '$'): string[] {
  if (schema.$ref) return validate(value, root.$defs![schema.$ref.replace('#/$defs/', '')], root, at)
  const errors: string[] = []
  const types = schema.type ? [schema.type].flat() : []
  if (types.length && !typeOf(value).some((t) => types.includes(t))) return [`${at}: expected ${types.join('|')}`]
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: ${JSON.stringify(value)} not in enum`)
  if (Array.isArray(value) && schema.items) value.forEach((v, i) => errors.push(...validate(v, schema.items!, root, `${at}[${i}]`)))
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    for (const key of schema.required || []) if (!(key in obj)) errors.push(`${at}.${key}: missing`)
    for (const [key, sub] of Object.entries(schema.properties || {})) if (key in obj) errors.push(...validate(obj[key], sub, root, `${at}.${key}`))
    if (schema.properties) for (const key of Object.keys(obj)) if (!(key in schema.properties)) errors.push(`${at}.${key}: not in schema`)
  }
  return errors
}

const schema = JSON.parse(fs.readFileSync(path.join(CONTRACT, 'v1.schema.json'), 'utf8'))
const fixture = JSON.parse(fs.readFileSync(path.join(CONTRACT, 'fixture.json'), 'utf8'))
assert.deepStrictEqual(validate(fixture, schema, schema), [], 'fixture matches the v1 schema')
assert.ok(validate({ ...fixture, state: { ...fixture.state, agents: [{ ...fixture.state.agents[0], state: 'busy' }] } }, schema, schema).length, 'schema rejects an unknown agent state')
assert.ok(validate({ ...fixture, usage: { claude: { fiveHour: '42' } } }, schema, schema).length, 'schema rejects wrong types and missing keys')
{
  const [main, bare] = fixture.state.agents
  for (const key of ['hostApp', 'pid', 'sessionId', 'lastActiveAt', 'canFocus']) {
    assert.ok(key in main, `fixture main agent carries ${key}`)
    assert.ok(!(key in bare), `fixture bare agent omits ${key}`)
  }
  assert.deepStrictEqual(fixture.state.approvals.map((a: { kind?: string }) => a.kind), ['permission', 'plan'])
  assert.deepStrictEqual(fixture.state.replies.map((r: { kind?: string; from?: string }) => [r.kind, r.from]), [[undefined, undefined], ['ask', 'hopper']])
  assert.ok(fixture.clis.some((c: { chat?: boolean }) => c.chat === true), 'fixture cli carries chat')
  assert.ok(fixture.requests.chat && fixture.requests.chatEnd && fixture.responses.chat && fixture.responses.chatEnd, 'fixture carries chat requests and responses')
  assert.strictEqual(fixture.responses.focus.via, 'cmux')
  const bad = (over: Record<string, unknown>, at: 'approvals' | 'replies' | 'agents') =>
    validate({ ...fixture, state: { ...fixture.state, [at]: [{ ...fixture.state[at][0], ...over }] } }, schema, schema).length > 0
  assert.ok(bad({ kind: 'nope' }, 'approvals'), 'schema rejects an unknown approval kind')
  assert.ok(bad({ kind: 'nope' }, 'replies'), 'schema rejects an unknown reply kind')
  assert.ok(bad({ canFocus: null }, 'agents'), 'schema rejects a null canFocus')
  assert.ok(bad({ pid: 1.5 }, 'agents'), 'schema rejects a fractional pid')
  for (const code of ['timeout', 'signed_out'] as const) {
    assert.deepStrictEqual(validate({ ...fixture, error: { ok: false, error: code, message: 'x' } }, schema, schema), [], `error ${code} in schema`)
    assert.strictEqual(new CuckooError(code, 'x').status, code === 'timeout' ? 504 : 409)
  }
  assert.ok(validate({ ...fixture, responses: { ...fixture.responses, focus: { ok: true, focused: true, via: 'tmux' } } }, schema, schema).length, 'schema rejects an unknown focus via')
  assert.deepStrictEqual(validate({ ...fixture, responses: { ...fixture.responses, focus: { ok: true, focused: false, via: null } } }, schema, schema), [], 'focus via may be null')
  console.log('cuckoo contract fixture: ok')
}

/** Fixture as it stood before the addendum; clients built against it must keep decoding. */
const PRE_ADDENDUM = {
  state: {
    v: 1,
    ts: 1763430000000,
    agents: [{"id": "herdr:main:w1:p2", "name": "agent-monitor", "codename": "eon", "colour": "#7c3aed", "state": "working", "host": "herdr", "terminalApp": "cmux", "scope": "herdr:main:w1", "space": "Drive - Generic", "isMain": true, "cwd": "/abs/path", "branch": "tech/overseer", "lastLine": "⏺ Reading src/index.ts", "cli": "claude", "canSend": true, "hostApp": "cmux", "pid": 4141, "sessionId": "5f0c1e2a-0000-4000-8000-000000000001", "lastActiveAt": 1763429990000, "canFocus": true}, {"id": "bare:4242:4242", "name": "path", "codename": null, "colour": null, "state": "unknown", "host": "bare", "terminalApp": null, "scope": null, "space": "Bare processes", "isMain": false, "cwd": "/abs/path", "branch": null, "lastLine": null, "cli": "codex", "canSend": false}],
    approvals: [{"id": "0123456789abcdef", "agentId": "herdr:main:w1:p2", "tool": "Bash", "command": "npm run check", "options": [{"key": "1", "label": "Yes"}, {"key": "2", "label": "Yes, and don't ask again"}, {"key": "3", "label": "No"}], "receivedAt": 1763430000000, "screenHash": "fedcba9876543210", "kind": "permission"}, {"id": "1123456789abcdef", "agentId": "herdr:main:w1:p2", "tool": "ExitPlanMode", "command": "Ship the contract freeze", "options": [{"key": "1", "label": "Yes"}, {"key": "2", "label": "No"}], "receivedAt": 1763430001000, "screenHash": "0edcba9876543210", "kind": "plan"}],
    replies: [{"id": "a1b2c3d4e5f60718", "agentId": "herdr:main:w1:p2", "codename": "eon", "text": "done, PR #86 open", "at": 1763430000000}, {"id": "b1b2c3d4e5f60719", "agentId": "herdr:main:w1:p2", "codename": "eon", "text": "which port for the test server?", "at": 1763430002000, "kind": "ask", "from": "hopper"}]
  },
  usage: {"claude": {"fiveHour": 42, "sevenDay": 61, "resetsAt": 1763440000, "stale": false}},
  clis: [{"cli": "claude", "path": "/abs/bin/claude", "version": "2.0.0", "signedIn": "unknown"}, {"cli": "codex", "path": "/abs/bin/codex", "version": "0.50.0", "signedIn": true, "chat": true}],
  error: {"ok": false, "error": "stale", "message": "agent changed since last poll"},
  requests: {"say": {"agentId": "herdr:main:w1:p2", "text": "run the checks"}, "approve": {"id": "0123456789abcdef", "decision": "allow"}, "focus": {"agentId": "herdr:main:w1:p2"}, "launch": {"cwd": "/abs/path", "prompt": "fix the build", "cli": "claude"}, "chat": {"cli": "claude", "text": "what is eon doing?", "conversationId": null}, "chatEnd": {"conversationId": "c-0001"}},
  responses: {"say": {"ok": true, "relayKey": "main-w1_p2", "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"}, "approve": {"ok": true, "sent": "1"}, "focus": {"ok": true, "focused": true, "via": "cmux"}, "launch": {"ok": true, "ref": "workspace:3"}, "chat": {"ok": true, "conversationId": "c-0001", "cli": "claude", "text": "eon is reading src/index.ts."}, "chatEnd": {"ok": true}}
}

{
  assert.deepStrictEqual(validate(PRE_ADDENDUM, schema, schema), [], 'pre-addendum fixture still matches the schema')
  const [main, bare] = fixture.state.agents
  assert.strictEqual(main.cmuxWorkspace, '0A0B0C0D-0000-4000-8000-000000000001')
  assert.ok(!('cmuxWorkspace' in bare), 'fixture bare agent omits cmuxWorkspace')
  assert.deepStrictEqual(fixture.requests.chat.attachments, ['u-0001'])
  assert.ok(fixture.state.music, 'fixture state carries music')
  for (const key of ['upload', 'sideAction', 'sideSettings', 'notes']) assert.ok(fixture.requests[key], `fixture request ${key}`)
  for (const key of ['upload', 'side', 'sideData', 'sideAction', 'recap', 'notes']) assert.ok(fixture.responses[key], `fixture response ${key}`)
  const sideIds = schema.$defs.sideId.enum as string[]
  assert.strictEqual(sideIds.length, 14, 'all 14 side ids in the schema')
  for (const p of fixture.responses.side.providers) assert.ok(sideIds.includes(p.id))
  const withState = (over: Record<string, unknown>) => validate({ ...fixture, state: { ...fixture.state, ...over } }, schema, schema)
  assert.deepStrictEqual(withState({ music: null }), [], 'music may be null')
  assert.ok(withState({ music: { ...fixture.state.music, player: 'winamp' } }).length, 'schema rejects an unknown music player')
  const withResponse = (key: string, value: unknown) => validate({ ...fixture, responses: { ...fixture.responses, [key]: value } }, schema, schema)
  assert.ok(withResponse('sideData', { ...fixture.responses.sideData, id: 'myspace' }).length, 'schema rejects an unknown side id')
  assert.ok(withResponse('side', { ...fixture.responses.side, providers: [{ ...fixture.responses.side.providers[0], reason: 'nope' }] }).length, 'schema rejects an unknown side reason')
  assert.ok(withResponse('upload', { ...fixture.responses.upload, bytes: 1.5 }).length, 'schema rejects fractional upload bytes')
  assert.ok(validate({ ...fixture, requests: { ...fixture.requests, chat: { ...fixture.requests.chat, attachments: [1] } } }, schema, schema).length, 'schema rejects non-string attachments')
  const statuses = { not_installed: 424, no_permission: 403, too_large: 413, needs_key: 424 } as const
  for (const [code, status] of Object.entries(statuses) as [keyof typeof statuses, number][]) {
    assert.deepStrictEqual(validate({ ...fixture, error: { ok: false, error: code, message: 'x' } }, schema, schema), [], `error ${code} in schema`)
    assert.strictEqual(new CuckooError(code, 'x').status, status)
  }
  console.log('cuckoo contract addendum: ok')
}

/** Fixture as it stood before addendum 2; clients built against it must keep decoding. */
const PRE_ADDENDUM_2 = {"state":{"v":1,"ts":1763430000000,"agents":[{"id":"herdr:main:w1:p2","name":"agent-monitor","codename":"eon","colour":"#7c3aed","state":"working","host":"herdr","terminalApp":"cmux","scope":"herdr:main:w1","space":"Drive - Generic","isMain":true,"cwd":"/abs/path","branch":"tech/overseer","lastLine":"⏺ Reading src/index.ts","cli":"claude","canSend":true,"hostApp":"cmux","pid":4141,"sessionId":"5f0c1e2a-0000-4000-8000-000000000001","lastActiveAt":1763429990000,"canFocus":true,"cmuxWorkspace":"0A0B0C0D-0000-4000-8000-000000000001"},{"id":"bare:4242:4242","name":"path","codename":null,"colour":null,"state":"unknown","host":"bare","terminalApp":null,"scope":null,"space":"Bare processes","isMain":false,"cwd":"/abs/path","branch":null,"lastLine":null,"cli":"codex","canSend":false}],"approvals":[{"id":"0123456789abcdef","agentId":"herdr:main:w1:p2","tool":"Bash","command":"npm run check","options":[{"key":"1","label":"Yes"},{"key":"2","label":"Yes, and don't ask again"},{"key":"3","label":"No"}],"receivedAt":1763430000000,"screenHash":"fedcba9876543210","kind":"permission"},{"id":"1123456789abcdef","agentId":"herdr:main:w1:p2","tool":"ExitPlanMode","command":"Ship the contract freeze","options":[{"key":"1","label":"Yes"},{"key":"2","label":"No"}],"receivedAt":1763430001000,"screenHash":"0edcba9876543210","kind":"plan"}],"replies":[{"id":"a1b2c3d4e5f60718","agentId":"herdr:main:w1:p2","codename":"eon","text":"done, PR #86 open","at":1763430000000},{"id":"b1b2c3d4e5f60719","agentId":"herdr:main:w1:p2","codename":"eon","text":"which port for the test server?","at":1763430002000,"kind":"ask","from":"hopper"}],"music":{"player":"spotify","playing":true,"title":"Night Drive","artist":null,"durationMs":215000,"positionMs":42000}},"usage":{"claude":{"fiveHour":42,"sevenDay":61,"resetsAt":1763440000,"stale":false}},"clis":[{"cli":"claude","path":"/abs/bin/claude","version":"2.0.0","signedIn":"unknown"},{"cli":"codex","path":"/abs/bin/codex","version":"0.50.0","signedIn":true,"chat":true}],"error":{"ok":false,"error":"stale","message":"agent changed since last poll"},"requests":{"say":{"agentId":"herdr:main:w1:p2","text":"run the checks"},"approve":{"id":"0123456789abcdef","decision":"allow"},"focus":{"agentId":"herdr:main:w1:p2"},"launch":{"cwd":"/abs/path","prompt":"fix the build","cli":"claude"},"chat":{"cli":"claude","text":"what is eon doing?","conversationId":null,"attachments":["u-0001"]},"chatEnd":{"conversationId":"c-0001"},"upload":{"name":"screenshot.png"},"sideAction":{"id":"mail","action":"draft","itemId":"m-1","text":null},"sideSettings":{"holdings":[{"symbol":"BTC","amount":0.05}],"hideProjects":true},"notes":{"title":"Standup","transcript":"we shipped the contract"}},"responses":{"say":{"ok":true,"relayKey":"main-w1_p2","sha256":"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"},"approve":{"ok":true,"sent":"1"},"focus":{"ok":true,"focused":true,"via":"cmux"},"launch":{"ok":true,"ref":"workspace:3"},"chat":{"ok":true,"conversationId":"c-0001","cli":"claude","text":"eon is reading src/index.ts."},"chatEnd":{"ok":true},"upload":{"ok":true,"uploadId":"u-0001","name":"screenshot.png","bytes":48213,"mime":"image/png"},"side":{"ok":true,"providers":[{"id":"github","available":true,"enabled":true,"via":"cli","reason":null},{"id":"resend","available":false,"enabled":false,"via":null,"reason":"needs_key"}],"settings":{"enabled":{"mail":false,"github":true},"holdings":[{"symbol":"BTC","amount":0.05}],"currency":"AUD","hideProjects":false,"phonePush":false}},"sideData":{"ok":true,"id":"mail","updatedAt":1763430000000,"items":[{"id":"m-1","title":"Release notes","subtitle":"from a teammate","value":null,"url":null,"tone":"warn","group":"reply","actions":["draft","open"]},{"id":"m-2","title":"Newsletter","subtitle":null,"value":null,"url":null,"tone":null,"group":"fyi","actions":[]}],"summary":"1 to reply, 1 fyi"},"sideAction":{"ok":true,"result":null},"recap":{"ok":true,"week":"2026-W47","sessions":12,"approvals":30,"finishes":9,"errors":1,"byCli":[{"cli":"claude","count":10},{"cli":"codex","count":2}],"topProjects":null,"activeDays":4},"notes":{"ok":true,"noteId":"n-0001","summary":"Contract shipped."}}}

{
  assert.deepStrictEqual(validate(PRE_ADDENDUM_2, schema, schema), [], 'pre-addendum-2 fixture still matches the schema')
  for (const key of ['supervise', 'superviseConfirm', 'stop']) {
    assert.ok(fixture.requests[key], `fixture request ${key}`)
    assert.ok(fixture.responses[key], `fixture response ${key}`)
    assert.ok(!(key in PRE_ADDENDUM_2.requests) && !(key in PRE_ADDENDUM_2.responses), `old fixture lacks ${key}`)
  }
  assert.ok(fixture.responses.supervise.pending && fixture.responses.superviseConfirm.pending === null, 'fixture carries pending and settled supervise')
  const withRequest = (key: string, value: unknown) => validate({ ...fixture, requests: { ...fixture.requests, [key]: value } }, schema, schema)
  const withResponse = (key: string, value: unknown) => validate({ ...fixture, responses: { ...fixture.responses, [key]: value } }, schema, schema)
  assert.deepStrictEqual(withRequest('supervise', { text: 'hi' }), [], 'supervise conversationId and cli are optional')
  assert.deepStrictEqual(withRequest('superviseConfirm', { confirmId: 'k' }), [], 'confirm cancel is optional')
  assert.ok(withRequest('supervise', {}).length, 'schema rejects supervise without text')
  assert.ok(withRequest('stop', {}).length, 'schema rejects stop without agentId')
  const sup = fixture.responses.supervise
  assert.ok(withResponse('supervise', { ...sup, intent: 'teleport' }).length, 'schema rejects an unknown intent')
  assert.ok(withResponse('supervise', { ...sup, pending: { ...sup.pending, expiresAt: 1.5 } }).length, 'schema rejects fractional expiresAt')
  assert.ok(withResponse('superviseConfirm', { ...sup, results: [{ agentId: 'x', ok: true }] }).length, 'schema rejects a result without error')
  assert.ok(withResponse('stop', { ok: true }).length, 'schema rejects stop without relayKey')
  console.log('cuckoo contract supervise: ok')
}

assert.strictEqual(mapState('blocked'), 'waiting')
assert.strictEqual(mapState('working'), 'working')
assert.strictEqual(mapState('done'), 'done')
assert.strictEqual(mapState('idle'), 'done')
assert.strictEqual(mapState('unknown'), 'unknown')
assert.strictEqual(mapState('weird'), 'unknown')

assert.strictEqual(claimKey('herdr:main:w1'), 'herdr_main_w1')
assert.strictEqual(claimKey('hc:space 1/x'), 'hc_space_1_x', 'filename sanitised like the mod')
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-claims-'))
  fs.writeFileSync(path.join(dir, `${claimKey('herdr:main:w1')}.json`), JSON.stringify({ surface: 'w1:p2', at: 1, focus: [] }))
  fs.writeFileSync(path.join(dir, 'broken.json'), '{')
  const claims = readClaims(dir)
  assert.deepStrictEqual(Object.keys(claims), ['herdr_main_w1'], 'unreadable claim ignored')
  assert.ok(isMainFor(claims, 'herdr:main:w1', 'w1:p2'), 'live surface is main')
  assert.ok(!isMainFor(claims, 'herdr:main:w1', 'w1:p9'), 'stale claim (other surface) is not main')
  assert.ok(!isMainFor(claims, null, 'w1:p2'))
  assert.deepStrictEqual(readClaims(path.join(dir, 'missing')), {})
  fs.rmSync(dir, { recursive: true, force: true })
}

{
  const herdr = (paneId: string, over: Partial<HerdrAgent> = {}): HerdrAgent => ({
    session: 'main', paneId, workspaceId: 'w1', tabId: 't1', agent: 'claude', status: 'working', title: '', cwd: '/x/repo', display: 'Drive - Generic', ...over
  })
  const snap: HerdrSnapshot = {
    at: 1,
    ok: true,
    sessions: ['main'],
    agents: [
      herdr('w1:p1', { name: 'zed', status: 'blocked' }),
      herdr('w1:p2', { name: 'yak', codename: 'eon', cmuxWorkspaceId: 'cmux-ws-1' }),
      herdr('t1a', { session: 'hc', host: 'herdr-app', workspaceId: 'sp1', display: 'Alpha', name: 'app', agent: 'claude-code', status: 'idle' })
    ]
  }
  const tabs = [
    { ref: 'workspace:1', id: 'cmux-ws-1', cwd: '/x', title: 'herdr host', lastActive: null },
    { ref: 'workspace:2', id: 'cmux-ws-2', cwd: '/y/other', title: 'side', lastActive: null }
  ]
  const procs = [{ pid: '42', cmd: 'codex', cwd: '/z/bare' }]
  const claims = { herdr_main_w1: { surface: 'w1:p2' }, hc_sp1: { surface: 'gone' } }
  const agents = toAgents(snap, tabs, procs, claims)
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]))

  assert.deepStrictEqual(agents.map((a) => a.id), ['herdr:main:w1:p2', 'herdr-app:hc:t1a', 'bare:42:42', 'cmux:workspace:2', 'herdr:main:w1:p1'], 'main first, then grouped by space, then name')
  assert.strictEqual(byId['herdr:main:w1:p2'].isMain, true)
  assert.strictEqual(byId['herdr:main:w1:p2'].scope, 'herdr:main:w1')
  assert.strictEqual(byId['herdr:main:w1:p2'].terminalApp, 'cmux')
  assert.strictEqual(byId['herdr:main:w1:p2'].cmuxWorkspace, 'cmux-ws-1', 'herdr agent carries its cmux workspace')
  assert.strictEqual(byId['herdr:main:w1:p1'].cmuxWorkspace, null)
  assert.strictEqual(byId['herdr:main:w1:p1'].isMain, false)
  assert.strictEqual(byId['herdr:main:w1:p1'].state, 'waiting')
  assert.strictEqual(byId['herdr-app:hc:t1a'].isMain, false, 'stale hc claim gives no main')
  assert.strictEqual(byId['herdr-app:hc:t1a'].host, 'herdr-app')
  assert.strictEqual(byId['herdr-app:hc:t1a'].scope, 'hc:sp1')
  assert.strictEqual(byId['herdr-app:hc:t1a'].cli, 'claude')
  assert.strictEqual(byId['herdr-app:hc:t1a'].state, 'done')
  assert.ok(!agents.some((a) => a.id.startsWith('cmux:workspace:1')), 'cmux tab hosting herdr is not listed twice')
  assert.strictEqual(byId['bare:42:42'].canSend, false)
  assert.strictEqual(byId['bare:42:42'].space, BARE_SPACE)
  assert.strictEqual(byId['bare:42:42'].cli, 'codex')
  for (const a of agents) assert.deepStrictEqual(validate(a, { $ref: '#/$defs/agent' }, schema), [], `agent ${a.id} matches the schema`)

  const spaces = agents.filter((a) => !a.isMain).map((a) => a.space)
  assert.deepStrictEqual(spaces, [...spaces].sort((a, b) => a.localeCompare(b)), 'non-main agents contiguous by space')

  const main = (id: string, space: string, isMain: boolean): Agent => ({ ...byId['herdr:main:w1:p1'], id, name: id, space, isMain })
  assert.deepStrictEqual(sortAgents([main('b', 'A', false), main('c', 'Z', true), main('a', 'A', false)]).map((a) => a.id), ['c', 'a', 'b'])
}

{
  const empty: HerdrSnapshot = { at: 1, ok: true, sessions: [], agents: [] }
  const tab = (n: number) => ({ ref: `workspace:${n}`, id: `ws-uuid-${n}`, cwd: `/r/${n}`, title: `tab ${n}`, lastActive: null })
  const claims = { [claimKey('cmux:ws-uuid-1')]: { surface: 'SURF-LIVE' }, [claimKey('cmux:ws-uuid-2')]: { surface: 'SURF-GONE' } }
  const surfaces = { 'workspace:1': ['surface:7', 'SURF-LIVE'], 'workspace:2': ['surface:8', 'SURF-OTHER'] }
  const byRef = Object.fromEntries(toAgents(empty, [tab(1), tab(2), tab(3)], [], claims, 'cmux', surfaces).map((a) => [a.id.split(':').slice(1, 3).join(':'), a]))
  assert.strictEqual(byRef['workspace:1'].isMain, true, 'cmux claim whose surface is live in the workspace is main')
  assert.strictEqual(byRef['workspace:2'].isMain, false, 'stale cmux claim (surface gone) is not main')
  assert.strictEqual(byRef['workspace:3'].isMain, false, 'cmux tab without a claim is not main')
  assert.strictEqual(toAgents(empty, [tab(1)], [], claims, 'cmux')[0].isMain, false, 'unlisted surfaces never count as main')
  assert.strictEqual(byRef['workspace:1'].id, 'cmux:workspace:1:SURF-LIVE', 'main cmux id carries the claimed surface')
  assert.strictEqual(byRef['workspace:2'].id, 'cmux:workspace:2', 'other cmux ids carry no surface')
}

{
  const surface = 'F16767EE-0000-4000-8000-000000000001'
  const snap: HerdrSnapshot = {
    at: 1,
    ok: true,
    sessions: ['main'],
    agents: [
      { session: 'main', paneId: 'w12:p3', workspaceId: 'w12', tabId: 't1', agent: 'claude', status: 'working', title: '', cwd: '/r' },
      { session: 'hc', host: 'herdr-app', paneId: 't4h', workspaceId: 'sp1', tabId: '', agent: 'claude', status: 'idle', title: '', cwd: '/r' }
    ]
  }
  const tabs = [
    { ref: 'workspace:5', id: '0A0B0C0D-0000-4000-8000-000000000005', cwd: '/r', title: 'main', lastActive: null },
    { ref: 'workspace:6', id: '0A0B0C0D-0000-4000-8000-000000000006', cwd: '/r', title: 'side', lastActive: null }
  ]
  const claims = { [claimKey('cmux:0A0B0C0D-0000-4000-8000-000000000005')]: { surface } }
  const cmuxAgents = toAgents(snap, tabs, [{ pid: '7', cmd: 'claude', cwd: '/r' }], claims, 'cmux', { 'workspace:5': [surface] })
  const tmuxAgents = toAgents({ ...snap, agents: [] }, [{ ref: 'ad-fix-a', cwd: '/r', title: 'fix', lastActive: null }], [], {}, 'tmux')
  const addr = Object.fromEntries([...cmuxAgents, ...tmuxAgents].filter((a) => a.canSend).map((a) => [a.id, addressOf(a)]))
  assert.deepStrictEqual(addr, {
    'herdr:main:w12:p3': { host: 'herdr', session: 'main', pane: 'w12:p3' },
    'herdr-app:hc:t4h': { host: 'herdr-app', session: 'hc', pane: 't4h' },
    [`cmux:workspace:5:${surface}`]: { host: 'cmux', session: 'workspace:5', pane: surface },
    'cmux:workspace:6': { host: 'cmux', session: 'workspace:6', pane: '' },
    'tmux:ad-fix-a:ad-fix-a': { host: 'tmux', session: 'ad-fix-a', pane: 'ad-fix-a' }
  }, 'addressOf parses every sendable id toAgents produces')
  const bare = cmuxAgents.find((a) => a.host === 'bare')!
  assert.throws(() => addressOf(bare), (e: unknown) => e instanceof CuckooError && e.status === 422, 'bare agents cannot be addressed')
}

{
  const hc = hcAgent({ address: 't9z', agent: 'claude', status: 'working', cwd: '/r' }, { labels: { 'herdr.space': 'space-42', codename: 'eon' } }, {})
  const [agent] = toAgents({ at: 1, ok: true, sessions: [], agents: [hc] }, [], [], { [claimKey('hc:space-42')]: { surface: 't9z' } })
  assert.strictEqual(agent.scope, 'hc:space-42', 'hc scope is the herdr.space label, as the mod writes it')
  assert.strictEqual(agent.isMain, true, 'hc claim surface is the bare terminal id')
}

{
  const fresh = claudeUsage(() => ({ five_hour: { used_percentage: 42, resets_at: '1763440000' }, seven_day: { used_percentage: 61, resets_at: '1763900000' }, updated_at: 1 }))
  assert.deepStrictEqual(fresh, { claude: { fiveHour: 42, sevenDay: 61, resetsAt: 1763440000, stale: false } })
  assert.deepStrictEqual(claudeUsage(() => null), { claude: { fiveHour: null, sevenDay: null, resetsAt: null, stale: true } }, 'stale or missing usage gives nulls')
  assert.deepStrictEqual(validate({ ...fixture, usage: fresh }, schema, schema), [])
}

{
  overrideHookSettings({})
  assert.strictEqual(usageFile(), path.join(os.homedir(), '.claude', 'usage-state.json'), 'empty settings fall back to the default usage file')
  overrideHookSettings({ usageStatePath: '~/custom/usage.json' })
  assert.strictEqual(usageFile(), path.join(os.homedir(), 'custom', 'usage.json'), 'configured path wins, ~ expanded')
  overrideHookSettings(null)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-usage-'))
  const file = path.join(dir, 'usage-state.json')
  fs.writeFileSync(file, JSON.stringify({ five_hour: { used_percentage: 12, resets_at: '1763440000' }, seven_day: { used_percentage: 34, resets_at: '1763900000' }, updated_at: 1_000_000 }))
  assert.deepStrictEqual(claudeUsage(() => readUsageFile(file, 1_000_000 + 60)), { claude: { fiveHour: 12, sevenDay: 34, resetsAt: 1763440000, stale: false } })
  assert.strictEqual(readUsageFile(file, 1_000_000 + 2 * 60 * 60 + 1), null, 'older than 2 h is stale')
  assert.strictEqual(readUsageFile(path.join(dir, 'missing.json')), null)
  fs.rmSync(dir, { recursive: true, force: true })
}

assert.ok(isCuckooPath('/api/v1/cuckoo/state'))
assert.ok(!isCuckooPath('/api/graph'))
assert.ok(!isCuckooPath('/api/v1/cuckoothing'))
{
  const index = fs.readFileSync(path.join(ROOT, 'src', 'index.ts'), 'utf8')
  const route = index.indexOf('if (isCuckooPath(url.pathname)) return handleCuckoo(')
  assert.ok(route > 0 && route < index.indexOf('noteClientSeen()\n'), 'cuckoo routes return before noteClientSeen()')
}

void (async () => {
  const ghost: Agent = { ...(JSON.parse(fs.readFileSync(path.join(CONTRACT, 'fixture.json'), 'utf8')).state.agents[0] as Agent), id: 'herdr:no-such-session:w99:p99' }
  rememberAgents([ghost])
  await assert.rejects(assertFresh(ghost), (e: unknown) => e instanceof CuckooError && e.status === 409, 'agent in the last poll but gone from fresh discovery gives 409')
  const loaded: HerdrSnapshot = { at: 5, ok: true, sessions: [], agents: [] }
  const refreshed: HerdrSnapshot = { at: 9, ok: true, sessions: ['s'], agents: [] }
  let refreshes = 0
  const refresh = async () => (refreshes++, refreshed)
  assert.strictEqual(await pollSnapshot(() => ({ ...loaded, at: 0 }), refresh), refreshed, 'never-loaded snapshot is awaited on the first poll')
  assert.strictEqual(await pollSnapshot(() => loaded, refresh), loaded, 'a loaded snapshot is served from cache')
  assert.strictEqual(refreshes, 1)
  console.log('cuckoo checks passed')
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
