import { expect, test } from 'claude-code/testing'
import type { LedgerEvent } from './ledger'
import { give } from './tool'

const NOW = 1_000_000_000
const LEDGER = '/h/.claude/demerits/ledger.jsonl'
const REFUSED = '/h/.claude/demerits/refused.jsonl'
const STATE = '/h/.claude/demerits-state'
const EVIDENCE = { kind: 'task', ref: 'T2.4' }

const prior = (points: number): LedgerEvent => ({
  id: `p${points}`, ts: NOW - 1000, session: 's', agent: 'turing', repo: '', branch: '', points, rule: 'good-work', reason: 'good work',
  evidence: {}, source: 'agent', by: 'hopper', scope: 'agent',
})

function world(files: Record<string, string> = {}, rank: 'super' | 'main' = 'super') {
  const fs = new Map(Object.entries(files))
  if (rank === 'super') fs.set(`${STATE}/super.json`, JSON.stringify({ agent: 'hopper' }))
  else fs.set(`${STATE}/parents.jsonl`, JSON.stringify({ child: 'ada', parent: 'hopper', via: 'factory', ts: NOW - 5 }))
  const $ = {
    session: { id: async () => 's1' },
    env: { get: async (k: string) => ({ HOME: '/h', HC_TERMINAL_ID: 't1' })[k] },
    clock: { now: async () => NOW },
    fs: { exists: async (p: string) => fs.has(p), read: async (p: string) => fs.get(p) ?? '' },
    process: {
      run: async (argv: string[]) => {
        if (argv[0] === '/bin/sh') {
          fs.set(argv[5], `${fs.get(argv[5]) ?? ''}${argv[4]}\n`)
          return { exitCode: 0, stdout: '', stderr: '' }
        }
        if (argv[0] === 'hc') return { exitCode: 0, stdout: JSON.stringify({ labels: { codename: 'hopper' } }), stderr: '' }
        return { exitCode: 1, stdout: '', stderr: '' }
      },
    },
  } as never
  const lines = (p: string) => (fs.get(p) ?? '').split('\n').filter(Boolean).map(l => JSON.parse(l))
  return { $, ledger: () => lines(LEDGER), refused: () => lines(REFUSED) }
}

const ledgerOf = (events: LedgerEvent[]) => ({ [LEDGER]: events.map(e => JSON.stringify(e)).join('\n') })

test('a super giving within the rubric appends an agent event', async () => {
  const w = world()
  const r = await give(w.$, {}, { target: 'turing', points: 3, reason: 'good work', evidence: EVIDENCE })
  expect(r).toMatchObject({ result: expect.stringContaining('Rubric amount suggested: 18') })
  expect(w.refused()).toEqual([])
  expect(w.ledger()).toEqual([
    expect.objectContaining({
      agent: 'turing', points: 3, rule: 'good-work', reason: 'good work', evidence: EVIDENCE, source: 'agent', by: 'hopper', scope: 'agent', rank: 'super', ts: NOW,
    }),
  ])
})

test('a subagent call is refused and logged', async () => {
  const w = world()
  const r = await give(w.$, {}, { target: 'turing', points: 1, reason: 'good work', evidence: EVIDENCE, agentId: 'a1' })
  expect(r).toMatchObject({ deny: expect.stringContaining('subagents') })
  expect(w.ledger()).toEqual([])
  expect(w.refused()).toEqual([expect.objectContaining({ agent: 'hopper', refused: 'subagents cannot give points' })])
})

test('missing or empty evidence is refused', async () => {
  const w = world()
  await give(w.$, {}, { target: 'turing', points: 1, reason: 'good work' })
  await give(w.$, {}, { target: 'turing', points: 1, reason: 'good work', evidence: { kind: 'task', ref: ' ' } })
  await give(w.$, {}, { target: 'turing', points: 1, reason: 'good work', evidence: { kind: 'vibes', ref: 'x' } })
  expect(w.ledger()).toEqual([])
  expect(w.refused().map(r => r.refused)).toEqual(Array(3).fill('evidence needs a kind and a ref'))
})

test('an amount above the rubric ceiling is refused', async () => {
  const w = world()
  const r = await give(w.$, {}, { target: 'turing', points: -5, reason: 'sloppy work', evidence: EVIDENCE })
  expect(r).toMatchObject({ deny: expect.stringContaining('rubric ceiling of 2') })
  expect(w.refused()).toEqual([expect.objectContaining({ refused: '5 is above the rubric ceiling of 2' })])
})

test('a main cannot score an agent that is not its sub', async () => {
  const w = world({}, 'main')
  const r = await give(w.$, {}, { target: 'turing', points: 1, reason: 'good work', evidence: EVIDENCE })
  expect(r).toMatchObject({ deny: expect.stringContaining('not one of your subs') })
  expect(w.refused()).toEqual([expect.objectContaining({ refused: 'turing is not one of your subs' })])
  const own = await give(w.$, {}, { target: 'ada', points: 1, reason: 'good work', evidence: EVIDENCE })
  expect(own).toHaveProperty('result')
})

test('the daily cap per target is enforced', async () => {
  const w = world(ledgerOf([prior(18)]))
  const r = await give(w.$, {}, { target: 'turing', points: 3, reason: 'good work', evidence: EVIDENCE })
  expect(r).toMatchObject({ deny: expect.stringContaining('daily cap') })
  expect(w.ledger()).toHaveLength(1)
  expect(w.refused()).toHaveLength(1)
})
