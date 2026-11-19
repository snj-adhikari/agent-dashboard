import { expect, test } from 'claude-code/testing'
import type { LedgerEvent } from './ledger'
import { strictRules, strictToolCheck } from './strict'

const DAY = 86_400_000
const NOW = 100 * DAY
const COMMIT = 'commit-without-ask'
const SHELL = 'git ' + 'commit -m wip'

const ev = (rule: string, daysAgo: number, over: Partial<LedgerEvent> = {}): LedgerEvent => ({
  id: `${rule}-${daysAgo}`,
  ts: NOW - daysAgo * DAY,
  session: 's1',
  agent: 'turing',
  repo: 'r',
  branch: 'b',
  points: -1,
  rule,
  reason: rule,
  evidence: {},
  source: 'hook',
  by: 'hook',
  scope: 'agent',
  ...over,
})

test('two events are not strict, the third turns it on', () => {
  expect(strictRules([ev(COMMIT, 2), ev(COMMIT, 1)], 'turing', NOW, 3, 7)).toEqual([])
  expect(strictRules([ev(COMMIT, 3), ev(COMMIT, 2), ev(COMMIT, 1)], 'turing', NOW, 3, 7)).toEqual([COMMIT])
})

test('seven clean days after the last event turns it off', () => {
  const events = [ev(COMMIT, 12), ev(COMMIT, 11), ev(COMMIT, 10)]
  expect(strictRules(events, 'turing', NOW, 3, 7)).toEqual([])
  expect(strictRules(events, 'turing', NOW - 4 * DAY, 3, 7)).toEqual([COMMIT])
})

test('another agent is unaffected', () => {
  const events = [ev(COMMIT, 3), ev(COMMIT, 2), ev(COMMIT, 1)]
  expect(strictRules(events, 'hopper', NOW, 3, 7)).toEqual([])
})

test('kudos, pool events and other rules do not count', () => {
  const events = [ev(COMMIT, 3, { points: 5 }), ev(COMMIT, 2, { scope: 'pool' }), ev('tamper', 1)]
  expect(strictRules(events, 'turing', NOW, 3, 7)).toEqual([])
})

test('threshold and window options are honoured', () => {
  const events = [ev(COMMIT, 2), ev(COMMIT, 1)]
  expect(strictRules(events, 'turing', NOW, 2, 7)).toEqual([COMMIT])
  const old = [ev(COMMIT, 20), ev(COMMIT, 19), ev(COMMIT, 18)]
  expect(strictRules(old, 'turing', NOW, 3, 30)).toEqual([COMMIT])
  expect(strictRules(old, 'turing', NOW, 3, 7)).toEqual([])
})

function world(events: LedgerEvent[], now = NOW) {
  const file = '/h/.claude/demerits/ledger.jsonl'
  let reads = 0
  const $ = {
    session: { id: async () => 's1' },
    env: { get: async (k: string) => ({ HOME: '/h', HC_TERMINAL_ID: 't1' })[k] },
    clock: { now: async () => now },
    fs: {
      exists: async (p: string) => p === file,
      read: async () => {
        reads += 1
        return events.map(e => JSON.stringify(e)).join('\n')
      },
    },
    process: { run: async () => ({ exitCode: 0, stdout: JSON.stringify({ labels: { codename: 'turing' } }), stderr: '' }) },
  } as never
  return { $, reads: () => reads }
}

const run = (w: ReturnType<typeof world>, tool: string, input: unknown, cfg = {}) =>
  strictToolCheck(w.$, { tool, input }, () => 'next', cfg)

test('a strict rule asks for its mapped command and reads the ledger once', async () => {
  const w = world([ev(COMMIT, 3), ev(COMMIT, 2), ev(COMMIT, 1)])
  const r = await run(w, 'Bash', { command: SHELL })
  expect(r).toMatchObject({ decision: 'ask' })
  expect((r as { reason: string }).reason).toContain(COMMIT)
  expect(w.reads()).toBe(1)
})

test('unmapped commands, other rules and clean agents pass through', async () => {
  const w = world([ev(COMMIT, 3), ev(COMMIT, 2), ev(COMMIT, 1)])
  expect(await run(w, 'Bash', { command: 'git status' })).toBe('next')
  expect(await run(w, 'Bash', { command: 'git push origin x' })).toBe('next')
  expect(await run(world([ev(COMMIT, 2)]), 'Bash', { command: SHELL })).toBe('next')
})

test('strict mode lapses with a mock clock past seven clean days', async () => {
  const events = [ev(COMMIT, 3), ev(COMMIT, 2), ev(COMMIT, 1)]
  expect(await run(world(events, NOW + 5 * DAY), 'Bash', { command: SHELL })).toMatchObject({ decision: 'ask' })
  expect(await run(world(events, NOW + 8 * DAY), 'Bash', { command: SHELL })).toBe('next')
})

test('threshold option lowers the bar for the check', async () => {
  const w = world([ev('push-without-ask', 2), ev('push-without-ask', 1)])
  expect(await run(w, 'Bash', { command: 'git push' })).toBe('next')
  expect(await run(w, 'Bash', { command: 'git push' }, { threshold: 2 })).toMatchObject({ decision: 'ask' })
})
