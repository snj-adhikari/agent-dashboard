import { expect, test } from 'claude-code/testing'
import {
  canGive,
  chainSessionStart,
  claimOnHumanPrompt,
  givenToday,
  liveParents,
  parentMap,
  rankFrom,
  rubricCeiling,
  type GiveInput,
  type ParentRow,
} from './chain'
import type { LedgerEvent } from './ledger'

const NOW = 10 * 86_400_000
const DAY = 86_400_000

const parents: Record<string, string> = { sub1: 'lynx', sub2: 'otto' }

const give = (over: Partial<GiveInput> = {}): GiveInput => ({
  giver: 'lynx',
  giverRank: 'main',
  target: 'sub1',
  targetRank: 'sub',
  parentOf: c => parents[c],
  points: 3,
  now: NOW,
  givenToday: 0,
  rubricCeiling: 5,
  ...over,
})

const refused = (i: GiveInput, match: RegExp) => {
  const v = canGive(i)
  expect(v.ok).toBe(false)
  expect(v.ok ? '' : v.reason).toMatch(match)
}

test('SNJ can give anyone, uncapped', () => {
  expect(canGive(give({ giver: 'snj', giverRank: 'snj', target: 'otto', targetRank: 'main', points: -50, givenToday: 500, rubricCeiling: 1 })).ok).toBe(true)
  expect(canGive(give({ giver: 'snj', giverRank: 'snj', target: 'zed', targetRank: 'super', points: 100 })).ok).toBe(true)
  refused(give({ giver: 'snj', giverRank: 'snj', target: 'snj' }), /yourself/)
})

test('any agent can give any other agent, up, down or across', () => {
  expect(canGive(give({ giver: 'zed', giverRank: 'super', target: 'lynx', targetRank: 'main' })).ok).toBe(true)
  expect(canGive(give({ giver: 'zed', giverRank: 'super', target: 'zed2', targetRank: 'super' })).ok).toBe(true)
  expect(canGive(give({ target: 'sub2' })).ok).toBe(true)
  expect(canGive(give({ target: 'zed', targetRank: 'super' })).ok).toBe(true)
  expect(canGive(give({ giver: 'sub1', giverRank: 'sub', target: 'lynx', targetRank: 'main', points: -3 })).ok).toBe(true)
  refused(give({ giver: 'sub1', giverRank: 'sub', target: 'sub1', targetRank: 'sub' }), /yourself/)
})

test('self, zero and fractional points are refused', () => {
  refused(give({ target: 'lynx', targetRank: 'main' }), /yourself/)
  refused(give({ points: 0 }), /non-zero/)
  refused(give({ points: 1.5 }), /whole number/)
})

test('amount above the rubric ceiling is refused, at the ceiling it passes', () => {
  expect(canGive(give({ points: 5, rubricCeiling: 5 })).ok).toBe(true)
  expect(canGive(give({ points: -1, rubricCeiling: 1 })).ok).toBe(true)
  refused(give({ points: 6, rubricCeiling: 5 }), /rubric ceiling of 5/)
  refused(give({ points: -3, rubricCeiling: 1 }), /rubric ceiling of 1/)
})

test('the daily cap is 20 per giver per target and counts both signs', () => {
  expect(canGive(give({ points: 5, givenToday: 15 })).ok).toBe(true)
  refused(give({ points: 5, givenToday: 16 }), /daily cap of 20/)
  refused(give({ points: -5, givenToday: 20 }), /daily cap of 20/)
})

test('givenToday sums a giver\'s agent gives to one target inside 24h and skips reversed ones', () => {
  const e = (over: Partial<LedgerEvent> & { reverses?: string }): LedgerEvent =>
    ({
      id: 'x',
      ts: NOW - 1000,
      session: 's',
      agent: 'sub1',
      repo: 'r',
      branch: 'b',
      points: 5,
      rule: 'no-blocks',
      reason: 'r',
      evidence: {},
      source: 'agent',
      by: 'lynx',
      scope: 'agent',
      ...over,
    }) as LedgerEvent
  const events = [
    e({ id: 'a' }),
    e({ id: 'b', points: -3 }),
    e({ id: 'old', ts: NOW - DAY - 1 }),
    e({ id: 'other-giver', by: 'otto' }),
    e({ id: 'other-target', agent: 'sub2' }),
    e({ id: 'snj-given', source: 'snj' }),
    e({ id: 'undone' }),
    e({ id: 'undo', points: -5, reverses: 'undone' }),
  ]
  expect(givenToday(events, 'lynx', 'sub1', NOW)).toBe(8)
})

test('parent links expire after 24h and the latest live row per child wins', () => {
  const rows: ParentRow[] = [
    { child: 'a', parent: 'old', via: 'factory', ts: NOW - DAY },
    { child: 'b', parent: 'lynx', via: 'factory', ts: NOW - DAY + 1 },
    { child: 'c', parent: 'x', via: 'factory', ts: NOW - 5000 },
    { child: 'c', parent: 'y', via: 'factory', ts: NOW - 1000 },
  ]
  const live = liveParents(rows, NOW)
  expect(live.get('a')).toBe(undefined)
  expect(live.get('b')).toBe('lynx')
  expect(live.get('c')).toBe('y')
})

test('rank: super file, human-prompt claim or factory lead make main or super, else sub', () => {
  const base = { ids: ['lynx', 't1x'], claimed: false, parents: [] as ParentRow[], now: NOW }
  expect(rankFrom(base)).toBe('sub')
  expect(rankFrom({ ...base, superAgent: 'lynx' })).toBe('super')
  expect(rankFrom({ ...base, superAgent: 'other' })).toBe('sub')
  expect(rankFrom({ ...base, claimed: true })).toBe('main')
  const dev = (parent: string, ts: number): ParentRow[] => [{ child: 'dev', parent, via: 'factory', ts }]
  expect(rankFrom({ ...base, parents: dev('lynx', NOW - 1000) })).toBe('main')
  expect(rankFrom({ ...base, parents: dev('t1x', NOW - 1000) })).toBe('main')
  expect(rankFrom({ ...base, parents: dev('lynx', NOW - DAY) })).toBe('sub')
  expect(rankFrom({ ...base, parents: dev('elsewhere', NOW) })).toBe('sub')
  expect(rankFrom({ ...base, superAgent: 'lynx', claimed: true })).toBe('super')
})

test('a MAIN claim counts only when an SNJ-typed prompt on that surface came just before it', () => {
  const me = ['hc:t1x']
  const claim = { surface: 'hc:t1x', at: NOW }
  expect(claimOnHumanPrompt([claim], [{ surface: 'hc:t1x', ts: NOW - 1000 }], me)).toBe(true)
  expect(claimOnHumanPrompt([claim], [], me)).toBe(false)
  expect(claimOnHumanPrompt([claim], [{ surface: 'hc:t1x', ts: NOW - 700_000 }], me)).toBe(false)
  expect(claimOnHumanPrompt([claim], [{ surface: 'hc:t1x', ts: NOW + 1 }], me)).toBe(false)
  expect(claimOnHumanPrompt([claim], [{ surface: 'hc:other', ts: NOW - 1000 }], me)).toBe(false)
  expect(claimOnHumanPrompt([{ surface: 'hc:other', at: NOW }], [{ surface: 'hc:t1x', ts: NOW - 1000 }], me)).toBe(false)
})

test('rubric: auto-kudos amounts, hook rules 1, named demerits, default 2', () => {
  expect(rubricCeiling('no-blocks', 1)).toBe(5)
  expect(rubricCeiling('no-rework', 1)).toBe(5)
  expect(rubricCeiling('redirections-none', 1)).toBe(5)
  expect(rubricCeiling('redirections-one', 1)).toBe(2)
  expect(rubricCeiling('few-prompts', 1)).toBe(3)
  expect(rubricCeiling('tamper', -1)).toBe(1)
  expect(rubricCeiling('push-without-ask', -1)).toBe(1)
  expect(rubricCeiling('commit-without-ask', -1)).toBe(3)
  expect(rubricCeiling('biased-scoring', -1)).toBe(5)
  expect(rubricCeiling('anything-else', -1)).toBe(2)
  expect(rubricCeiling('ignored-stop', -1)).toBe(5)
  expect(rubricCeiling('unapproved-git', -1)).toBe(3)
  expect(rubricCeiling('over-explaining', -1)).toBe(1)
  expect(rubricCeiling('first-time-right', 1)).toBe(5)
  expect(rubricCeiling('short-and-clear', 1)).toBe(2)
})

function world(env: Record<string, string>, files: Record<string, string> = {}) {
  const vars: Record<string, string> = { HOME: '/h', ...env }
  const $ = {
    session: { id: async () => 's-dev' },
    env: { get: async (k: string) => vars[k] },
    clock: { now: async () => NOW },
    fs: { exists: async (p: string) => p in files, read: async (p: string) => files[p] },
    process: {
      run: async (argv: string[]) => {
        if (argv[0] === '/bin/sh') {
          files[argv[5]] = (files[argv[5]] ?? '') + `${argv[4]}\n`
          return { exitCode: 0, stdout: '', stderr: '' }
        }
        if (argv.join(' ') === 'hc get t1f --json') return { exitCode: 0, stdout: '{"labels":{"codename":"lynx"}}', stderr: '' }
        if (argv.join(' ') === 'hc get t1x --json') return { exitCode: 0, stdout: '{"labels":{"codename":"dev9"}}', stderr: '' }
        return { exitCode: 1, stdout: '', stderr: '' }
      },
    },
  } as never
  return { $, files }
}

test('a dev session records its lead by codename and address, and the link expires', async () => {
  const w = world({ FACTORY_LEAD: 't1f', HC_TERMINAL_ID: 't1x' })
  let passed = false
  await chainSessionStart(w.$, { a: 1 }, () => {
    passed = true
  }, {})
  expect(passed).toBe(true)
  const rows = w.files['/h/.claude/demerits-state/parents.jsonl'].split('\n').filter(Boolean).map(l => JSON.parse(l) as ParentRow)
  expect(rows.map(r => [r.child, r.parent, r.via])).toEqual([
    ['dev9', 't1f', 'factory-address'],
    ['dev9', 'lynx', 'factory'],
  ])
  expect((await parentMap(w.$)).get('dev9')).toBe('lynx')
})

test('no FACTORY_LEAD records nothing and still passes the event on', async () => {
  const w = world({})
  let passed = false
  await chainSessionStart(w.$, {}, () => {
    passed = true
  }, {})
  expect(passed).toBe(true)
  expect(w.files['/h/.claude/demerits-state/parents.jsonl']).toBe(undefined)
})
