import { expect, test } from 'claude-code/testing'
import { audit, biasCheck, biasSessionStart } from './bias'
import type { LedgerEvent } from './ledger'

const NOW = 1_000_000_000
const LEDGER = '/h/.claude/demerits/ledger.jsonl'
const STATE = '/h/.claude/demerits-state'
const parents = new Map([['sub', 'lead']])

const ev = (o: Partial<LedgerEvent>): LedgerEvent => ({
  id: 'e', ts: NOW - 1000, session: 's', agent: 'sub', repo: '', branch: '', points: 1, rule: 'x', reason: 'r',
  evidence: {}, source: 'agent', by: 'lead', scope: 'agent', ...o,
})
const kudos = (o: Partial<LedgerEvent> = {}) => ev({ id: 'k1', points: 3, rule: 'good-work', evidence: { kind: 'task', ref: 'T1' }, ...o })
const verified = ev({ id: 'v1', points: 0, rule: 'verified-task', source: 'auto', by: 'auto', evidence: { taskKey: 's:abc' }, ts: NOW - 3 * 86_400_000 })
const block = ev({ id: 'b1', points: -1, rule: 'tamper', source: 'hook', by: 'hook' })

test('kudos to a sub with a verified task in the last 7 days is clean', () => {
  expect(audit([kudos(), verified], 'lead', parents, NOW)).toEqual([])
})

test('kudos to a sub with no verified-task or good-work event in 7 days is flagged', () => {
  const old = { ...verified, ts: NOW - 8 * 86_400_000 }
  expect(audit([kudos(), old], 'lead', parents, NOW)).toEqual([
    expect.stringContaining('kudos without matching evidence'),
  ])
})

test('kudos with a hook block and no demerit is flagged, a demerit clears it', () => {
  expect(audit([kudos(), verified, block], 'lead', parents, NOW)).toEqual([expect.stringContaining('no demerit despite hook blocks')])
  const demerit = ev({ id: 'd1', points: -1, rule: 'tamper', evidence: { kind: 'hook-block', ref: 'b1' } })
  expect(audit([kudos(), verified, block, demerit], 'lead', parents, NOW)).toEqual([])
})

test('only the giver own subs inside 24h count', () => {
  const stale = kudos({ ts: NOW - 90_000_000 })
  expect(audit([stale], 'lead', parents, NOW)).toEqual([])
  expect(audit([kudos()], 'lead', new Map(), NOW)).toEqual([])
})

function world(events: LedgerEvent[], files: Record<string, string> = {}) {
  const fs = new Map(Object.entries({ [LEDGER]: events.map(e => `${JSON.stringify(e)}\n`).join(''), ...files }))
  fs.set(`${STATE}/parents.jsonl`, JSON.stringify({ child: 'sub', parent: 'lead', via: 'factory', ts: NOW - 5 }))
  const $ = {
    session: { id: async () => 's1' },
    env: { get: async (k: string) => (k === 'HOME' ? '/h' : undefined) },
    clock: { now: async () => NOW },
    fs: {
      exists: async (p: string) => fs.has(p),
      read: async (p: string) => fs.get(p) ?? '',
      write: async (p: string, t: string) => void fs.set(p, t),
    },
    process: {
      run: async (argv: string[]) => {
        if (argv[0] === '/bin/sh') fs.set(argv[5], `${fs.get(argv[5]) ?? ''}${argv[4]}\n`)
        else if (argv[0] === 'mv') {
          fs.set(argv[3], fs.get(argv[2]) ?? '')
          fs.delete(argv[2])
        }
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    },
  } as never
  const events2 = () => (fs.get(LEDGER) ?? '').split('\n').filter(Boolean).map(l => JSON.parse(l) as LedgerEvent)
  return { $, fs, events: events2 }
}

const bad = kudos()

test('biasCheck appends one -5 biased-scoring per giver per day', async () => {
  const w = world([bad])
  await biasCheck(w.$, {}, 'lead')
  await biasCheck(w.$, {}, 'lead')
  const hits = w.events().filter(e => e.rule === 'biased-scoring')
  expect(hits).toEqual([
    expect.objectContaining({ points: -5, source: 'auto', by: 'auto', scope: 'agent', agent: 'lead', biased: true, evidence: { findings: [expect.any(String)] } }),
  ])
})

test('a clean giver is untouched', async () => {
  const w = world([kudos(), verified])
  expect(await biasCheck(w.$, {}, 'lead')).toBeUndefined()
  expect(w.events().filter(e => e.rule === 'biased-scoring')).toEqual([])
})

test('the sweep runs once a day and stamps the state dir', async () => {
  const w = world([bad])
  await biasSessionStart(w.$, {}, e => e, {})
  expect(w.events().filter(e => e.rule === 'biased-scoring')).toHaveLength(1)
  expect(JSON.parse(w.fs.get(`${STATE}/bias-sweep.json`) as string)).toEqual({ ts: NOW })
  const again = world([bad], { [`${STATE}/bias-sweep.json`]: JSON.stringify({ ts: NOW - 1000 }) })
  await biasSessionStart(again.$, {}, e => e, {})
  expect(again.events().filter(e => e.rule === 'biased-scoring')).toEqual([])
})
