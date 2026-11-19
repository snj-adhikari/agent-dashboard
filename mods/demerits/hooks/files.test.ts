import { expect, test } from 'claude-code/testing'
import { fold } from './balances'
import { blockLines, goodWorkMd, guidelinesMd, pointsMd } from './files'
import type { LedgerEvent } from './ledger'

const DAY = 86_400_000
const NOW = 10 * DAY

const event = (over: Partial<LedgerEvent> = {}): LedgerEvent => ({
  id: 'e1',
  ts: NOW,
  session: 's1',
  agent: 'biscuit',
  repo: 'r',
  branch: 'b',
  points: -1,
  rule: 'tamper',
  reason: 'touched a guarded file',
  evidence: {},
  source: 'hook',
  by: 'hook',
  scope: 'agent',
  ...over,
})

const good = (id: string, ts: number, points: number, reason: string, evidence: LedgerEvent['evidence'] = {}) =>
  event({ id, ts, points, reason, rule: 'good-work', source: 'auto', by: 'auto', evidence })

test('manual section is kept verbatim and the block is regenerated around it', () => {
  const manual = '## Manual\n- always: run tests first\n\n  indented note\n'
  const first = guidelinesMd(`# Guidelines\n\n${manual}`, [event()])
  expect(first).toContain('## Manual\n- always: run tests first\n\n  indented note\n')
  const second = guidelinesMd(first, [event(), event({ id: 'e2' })])
  expect(second).toContain('## Manual\n- always: run tests first\n\n  indented note\n')
  expect(second.match(/demerits:start/g)?.length).toBe(1)
  expect(guidelinesMd(second, [event(), event({ id: 'e2' })])).toBe(second)
})

test('a missing manual heading is created empty', () => {
  const out = guidelinesMd('', [event()])
  expect(out).toContain('## Manual\n\n<!-- demerits:start -->')
})

test('a manual slug line overrides the generated line for that slug', () => {
  const existing = "## Manual\n- tamper: Don't edit guard files, ever.\n"
  const out = guidelinesMd(existing, [event()])
  const block = out.slice(out.indexOf('<!-- demerits:start -->'))
  expect(block).toContain("- tamper: Don't edit guard files, ever.")
  expect(block).not.toContain('touched a guarded file')
})

test('generated block stays under 12 lines with many rules and examples', () => {
  const events = [
    ...['a', 'b', 'c', 'd', 'e'].map((rule, i) => event({ id: `l${i}`, rule, reason: `lost ${rule}` })),
    ...['x', 'y', 'z'].map((rule, i) => event({ id: `k${i}`, rule, points: 5, reason: `kudos ${rule}`, source: 'snj', by: 'snj' })),
    ...[1, 2, 3, 4, 5].map(i => good(`g${i}`, NOW - i * 1000, i, `win ${i}`)),
  ]
  const block = guidelinesMd('', events).split('\n')
  const start = block.indexOf('<!-- demerits:start -->')
  const end = block.indexOf('<!-- demerits:end -->')
  expect(end - start + 1).toBeLessThan(12)
  expect(blockLines(events).length).toBeLessThan(10)
  expect(blockLines(events).filter(l => l.startsWith('>')).length).toBe(3)
})

test('points.md has the pool line, the table, last events and the good-work link', () => {
  const events = [event({ points: -3, id: 'a' }), good('b', NOW - 1000, 5, 'clean task')]
  const registry = [{ agent: 'biscuit', rank: 'sub' as const, start: 500, ts: 1 }]
  const md = pointsMd(fold(events, registry, NOW, 7), events, NOW, 7)
  expect(md).toContain('Team pool: 5002 (+2 this week)')
  expect(md).toContain('| biscuit | sub | 502 | +2 | 5 | 0 |')
  expect(md).toContain('- tamper: 1x, -3')
  expect(md).toContain('[good work](good-work.md)')
  expect(md.split('\n').filter(l => l.startsWith('| 1970')).length).toBe(2)
})

test('good-work.md lists positive events newest first, max 20, skipping reversed ones', () => {
  const events = [
    good('old', NOW - 5 * DAY, 5, 'older win', { task: 'T-1', counts: { blocks: 0, rework: 0 } }),
    good('new', NOW - DAY, 2, 'newer win'),
    event({ id: 'neg', points: -2 }),
    good('gone', NOW, 5, 'reversed win'),
    { ...event({ id: 'rev', points: -5 }), reverses: 'gone' } as LedgerEvent,
    ...Array.from({ length: 25 }, (_, i) => good(`bulk${i}`, NOW - 6 * DAY - i * 1000, 1, `bulk ${i}`)),
  ]
  const md = goodWorkMd(events)
  expect(md.indexOf('newer win')).toBeLessThan(md.indexOf('older win'))
  expect(md).toContain('| T-1 | older win (blocks 0, rework 0) | +5 |')
  expect(md).not.toContain('reversed win')
  expect(md.split('\n').filter(l => l.startsWith('| 1970')).length).toBe(20)
})
