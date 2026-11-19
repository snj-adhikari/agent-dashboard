import assert from 'assert'
import path from 'path'
import { io } from './services/cuckoo/keys'
import { focusAgent } from './services/cuckoo/focus'
import type { Agent } from './services/cuckoo/agents'

const calls: { cmd: string; args: string[]; env?: NodeJS.ProcessEnv }[] = []
let failHerdr = false
io.run = async (cmd, args, env) => {
  calls.push({ cmd: path.basename(cmd), args, env })
  if (failHerdr && path.basename(cmd) === 'herdr') throw new Error('no such agent')
  return ''
}

const base: Agent = { id: '', name: 'x', codename: null, colour: null, state: 'working', host: 'bare', terminalApp: null, scope: null, space: 's', isMain: false, cwd: '/', branch: null, lastLine: null, cli: 'claude', canSend: true }
const agent = (o: Partial<Agent> & { hostApp?: string | null; canFocus?: boolean }): Agent => ({ ...base, ...o }) as Agent
const run = async (a: Agent): Promise<{ res: unknown; seen: string[][] }> => {
  calls.length = 0
  const res = await focusAgent(a)
  return { res, seen: calls.map((c) => [c.cmd, ...c.args]) }
}

async function main(): Promise<void> {
  {
    const { res, seen } = await run(agent({ id: 'cmux:workspace:3:surface:7', host: 'cmux', terminalApp: 'cmux' }))
    assert.deepStrictEqual(res, { ok: true, focused: true, via: 'cmux' })
    assert.deepStrictEqual(seen, [['cmux', 'select-workspace', '--workspace', 'workspace:3'], ['cmux', 'focus-panel', '--panel', 'surface:7', '--workspace', 'workspace:3'], ['open', '-a', 'cmux']], 'focus cmux args')
    const bare = await run(agent({ id: 'cmux:workspace:3', host: 'cmux' }))
    assert.deepStrictEqual(bare.seen, [['cmux', 'select-workspace', '--workspace', 'workspace:3'], ['open', '-a', 'cmux']], 'focus cmux args: unclaimed workspace selects only')
    const bad = await run(agent({ id: 'cmux:workspace:3;rm -rf ~', host: 'cmux' }))
    assert.deepStrictEqual([bad.res, bad.seen], [{ ok: true, focused: false, via: null }, []], 'focus cmux args: bad ref never runs')
  }
  {
    const { res, seen } = await run(agent({ id: 'herdr-app:hc:t1a', host: 'herdr-app', terminalApp: 'herdr-app' }))
    assert.deepStrictEqual(res, { ok: true, focused: true, via: 'herdr-app' })
    assert.deepStrictEqual(seen, [['herdr-app', 'do', 'pane.focus', '{"terminal":"t1a"}'], ['open', '-a', 'Herdr']], 'focus herdr-app args')
    const bad = await run(agent({ id: 'herdr-app:hc:--evil', host: 'herdr-app' }))
    assert.deepStrictEqual(bad.seen, [], 'focus herdr-app args: bad pane never runs')
  }
  {
    const a = agent({ id: 'herdr:main:w1:p2', host: 'herdr', codename: 'eon', terminalApp: 'cmux' })
    const { res, seen } = await run(a)
    assert.deepStrictEqual(res, { ok: true, focused: true, via: 'herdr' })
    assert.deepStrictEqual(seen, [['herdr', 'agent', 'focus', 'w1:p2'], ['open', '-a', 'cmux']], 'focus herdr args')
    assert.strictEqual(calls[0].env?.HERDR_SESSION, 'main', 'focus herdr args: session env')
    failHerdr = true
    const fb = await run(a)
    assert.deepStrictEqual(fb.seen, [['herdr', 'agent', 'focus', 'w1:p2'], ['snj-term', 'attach', 'main', 'eon'], ['open', '-a', 'cmux']], 'focus herdr args: snj-term fallback')
    await assert.rejects(focusAgent(agent({ id: 'herdr:main:w1:p2', host: 'herdr', name: 'Bad Name' })), /no such agent/, 'focus herdr args: no fallback without a safe name')
    failHerdr = false
    const ws = '0A0B0C0D-0000-4000-8000-000000000001'
    const inCmux = await run(agent({ ...a, cmuxWorkspace: ws }))
    assert.deepStrictEqual(inCmux.seen, [['cmux', 'select-workspace', '--workspace', ws], ['herdr', 'agent', 'focus', 'w1:p2'], ['open', '-a', 'cmux']], 'focus herdr args: cmux workspace selected first')
    const badWs = await run(agent({ ...a, cmuxWorkspace: 'workspace:1;rm -rf ~' }))
    assert.deepStrictEqual(badWs.seen, [['herdr', 'agent', 'focus', 'w1:p2'], ['open', '-a', 'cmux']], 'focus herdr args: bad cmux workspace never runs')
  }
  {
    const desk = await run(agent({ id: 'bare:42:42', host: 'bare', hostApp: 'Claude' }))
    assert.deepStrictEqual([desk.res, desk.seen], [{ ok: true, focused: true, via: 'app' }, [['open', '-a', 'Claude']]], 'focus app activate only')
    const term = await run(agent({ id: 'bare:43:43', host: 'bare', hostApp: 'Terminal' }))
    assert.deepStrictEqual(term.seen, [['open', '-a', 'Terminal']], 'focus app activate only: Terminal')
    const unknown = await run(agent({ id: 'bare:44:44', host: 'bare', hostApp: 'Evil; rm' }))
    assert.deepStrictEqual([unknown.res, unknown.seen], [{ ok: true, focused: false, via: null }, []], 'focus app activate only: unknown app never runs')
    const off = await run(agent({ id: 'cmux:workspace:3', host: 'cmux', canFocus: false }))
    assert.deepStrictEqual([off.res, off.seen], [{ ok: true, focused: false, via: null }, []], 'focus canFocus false')
  }
  console.log('cuckooFocusCheck ok: focus cmux args, focus herdr-app args, focus herdr args, focus app activate only')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
