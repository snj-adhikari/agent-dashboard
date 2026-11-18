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
