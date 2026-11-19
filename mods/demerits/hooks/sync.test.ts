import { expect, test } from 'claude-code/testing'
import type { LedgerEvent } from './ledger'
import { syncClassicSessionStart, syncClassicSubagentStart, syncTurnComplete } from './sync'

const NOW = 1_000_000_000
const OPTIONS = {}
const LEDGER = '/h/.claude/demerits/ledger.jsonl'

const event = (id: string, over: Partial<LedgerEvent> = {}): LedgerEvent => ({
  id, ts: NOW - 1000, session: 's1', agent: 'dexter', repo: 'r', branch: 'b', points: -1, rule: 'tamper',
  reason: 'touched a guarded file', evidence: {}, source: 'hook', by: 'hook', scope: 'agent', ...over,
})

const good = (id: string) => event(id, { points: 5, rule: 'good-work', source: 'auto', by: 'auto', reason: 'shipped it clean' })

function world(initial: LedgerEvent[] = []) {
  const fs = new Map<string, string>([[LEDGER, initial.map(e => `${JSON.stringify(e)}\n`).join('')]])
  const posted: string[] = []
  const state = { up: true }
  const $ = {
    session: { id: async () => 's1' },
    env: { get: async (k: string) => ({ HOME: '/h' })[k] },
    clock: { now: async () => NOW },
    fs: {
      exists: async (p: string) => fs.has(p),
      read: async (p: string) => fs.get(p) ?? '',
      write: async (p: string, t: string) => void fs.set(p, t),
    },
    http: {
      fetch: async (_url: string, init: { body: string }) => {
        if (!state.up) throw new Error('down')
        posted.push(JSON.parse(init.body).event.id)
        return { status: 200, ok: true, headers: {}, text: '{"ok":true}' }
      },
    },
    process: {
      run: async (argv: string[]) => {
        if (argv[0] === '/bin/sh') fs.set(argv[5], `${fs.get(argv[5]) ?? ''}${argv[4]}\n`)
        if (argv[0] === 'mv') {
          fs.set(argv[3], fs.get(argv[2]) ?? '')
          fs.delete(argv[2])
        }
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    },
  } as never
  const add = (e: LedgerEvent) => void fs.set(LEDGER, `${fs.get(LEDGER)}${JSON.stringify(e)}\n`)
  return { $, fs, posted, state, add }
}

const pass = (e: unknown) => e

test('new lines are posted once and regenerate runs once per sync', async () => {
  const w = world([event('a'), event('b')])
  await syncTurnComplete(w.$, {}, pass, OPTIONS)
  expect(w.posted).toEqual(['a', 'b'])
  const regenerated = w.fs.get('/h/.claude/demerits/points.md')
  expect(regenerated).toContain('dexter')
  w.fs.set('/h/.claude/demerits/points.md', 'marker')
  await syncTurnComplete(w.$, {}, pass, OPTIONS)
  expect(w.posted).toEqual(['a', 'b'])
  expect(w.fs.get('/h/.claude/demerits/points.md')).toBe('marker')
  w.add(event('c'))
  await syncTurnComplete(w.$, {}, pass, OPTIONS)
  expect(w.posted).toEqual(['a', 'b', 'c'])
  expect(w.fs.get('/h/.claude/demerits/points.md')).not.toBe('marker')
})

test('a failed POST never throws and is retried next time', async () => {
  const w = world([event('a'), event('b')])
  w.state.up = false
  expect(await syncTurnComplete(w.$, { x: 1 }, pass, OPTIONS)).toEqual({ x: 1 })
  expect(w.posted).toEqual([])
  w.state.up = true
  await syncTurnComplete(w.$, {}, pass, OPTIONS)
  expect(w.posted).toEqual(['a', 'b'])
})

test('guidelines only on startup and clear; subagents always get them', async () => {
  const w = world([good('g1'), good('g2')])
  await syncTurnComplete(w.$, {}, pass, OPTIONS)
  const text = async (source: string) =>
    JSON.stringify(((await syncClassicSessionStart(w.$, { source }, () => undefined, OPTIONS)) as { additionalContext?: string[] } | undefined)?.additionalContext ?? [])
  expect(await text('startup')).toContain('shipped it clean')
  expect(await text('clear')).toContain('shipped it clean')
  expect(await text('resume')).not.toContain('shipped it clean')
  const sub = (await syncClassicSubagentStart(w.$, {}, () => undefined, OPTIONS)) as { additionalContext: string[] }
  expect(JSON.stringify(sub.additionalContext)).toContain('shipped it clean')
})

test('silent when there is nothing to say', async () => {
  const w = world()
  expect(await syncClassicSessionStart(w.$, { source: 'startup' }, () => undefined, OPTIONS)).toBeUndefined()
  expect(await syncClassicSubagentStart(w.$, {}, () => undefined, OPTIONS)).toBeUndefined()
})
