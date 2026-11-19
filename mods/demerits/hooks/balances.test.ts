import { expect, test } from 'claude-code/testing'
import { fold, startOf, type RegistryRow } from './balances'
import type { LedgerEvent } from './ledger'

const NOW = 10 * 86_400_000
const DAY = 86_400_000

const event = (over: Partial<LedgerEvent> = {}): LedgerEvent => ({
  id: 'e1',
  ts: NOW,
  session: 's1',
  agent: 'banjo',
  repo: 'r',
  branch: 'b',
  points: -1,
  rule: 'tamper',
  reason: 'r',
  evidence: {},
  source: 'hook',
  by: 'hook',
  scope: 'agent',
  ...over,
})

const registry: RegistryRow[] = [
  { agent: 'banjo', rank: 'sub', start: 500, ts: 1 },
  { agent: 'lynx', rank: 'main', start: 1000, ts: 2 },
  { agent: 'zed', rank: 'super', start: 2000, ts: 3 },
]

const agentOf = (events: LedgerEvent[], name: string, reg = registry) =>
  fold(events, reg, NOW, 7).agents.find(a => a.agent === name)!

test('start balance is fixed by rank and the first sighting sticks', () => {
  expect(startOf(registry, 'banjo')).toBe(500)
  expect(startOf(registry, 'lynx')).toBe(1000)
  expect(startOf(registry, 'zed')).toBe(2000)
  expect(startOf(registry, 'nobody')).toBe(undefined)
  const promoted = [...registry, { agent: 'banjo', rank: 'main' as const, start: 1000, ts: 9 }]
  expect(startOf(promoted, 'banjo')).toBe(500)
  const a = agentOf([], 'banjo', promoted)
  expect(a.rank).toBe('main')
  expect(a.balance).toBe(500)
})

test('an agent event moves the agent and the pool', () => {
  const f = fold([event({ points: -3 })], registry, NOW, 7)
  expect(f.agents.find(a => a.agent === 'banjo')!.balance).toBe(497)
  expect(f.agents.find(a => a.agent === 'lynx')!.balance).toBe(1000)
  expect(f.pool.balance).toBe(4997)
})

test('a pool event moves only the pool', () => {
  const f = fold([event({ points: -10, scope: 'pool' })], registry, NOW, 7)
  expect(f.agents.every(a => a.xp === 0)).toBe(true)
  expect(f.agents.find(a => a.agent === 'banjo')!.balance).toBe(500)
  expect(f.pool).toEqual({ balance: 4990, week: -10 })
})

test('xp counts verified tasks and positive kudos, never demerits, and levels every 100', () => {
  const events = [
    event({ id: 'v', points: 0, rule: 'verified-task', source: 'auto' }),
    event({ id: 'k1', points: 5, rule: 'kudos', source: 'snj' }),
    event({ id: 'k2', points: 100, rule: 'kudos', source: 'auto' }),
    event({ id: 'k3', points: 50, rule: 'kudos', source: 'agent' }),
    event({ id: 'd', points: -4, source: 'snj' }),
    event({ id: 'p', points: 50, rule: 'kudos', source: 'snj', scope: 'pool' }),
  ]
  const a = agentOf(events, 'banjo')
  expect(a.xp).toBe(106)
  expect(a.level).toBe(1)
})

test('a reversal cancels balance, pool and xp of the original', () => {
  const orig = event({ id: 'k', points: 120, rule: 'kudos', source: 'snj' })
  const rev = event({ id: 'r', points: -120, rule: 'kudos', source: 'snj', reverses: 'k' })
  const f = fold([orig, rev], registry, NOW, 7)
  const a = f.agents.find(x => x.agent === 'banjo')!
  expect(a).toMatchObject({ balance: 500, week: 0, xp: 0, level: 0 })
  expect(f.pool).toEqual({ balance: 5000, week: 0 })
})

test('week sums only events inside the window', () => {
  const events = [
    event({ id: 'old', points: -5, ts: NOW - 8 * DAY }),
    event({ id: 'new', points: -2, ts: NOW - 6 * DAY }),
  ]
  const f = fold(events, registry, NOW, 7)
  const a = f.agents.find(x => x.agent === 'banjo')!
  expect(a.week).toBe(-2)
  expect(a.balance).toBe(493)
  expect(f.pool).toEqual({ balance: 4993, week: -2 })
})
