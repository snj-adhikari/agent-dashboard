import { expect, test } from 'claude-code/testing'
import { fold } from './balances'
import type { LedgerEvent } from './ledger'
import { GUIDELINE, reminderPromptSubmit, reminderText, statusText } from './reminder'

const DAY = 86_400_000
const HOUR = 3_600_000
const NOW = 100 * DAY
const RULE = 'commit-without-ask'

const ev = (rule: string, points: number, ago: number, over: Partial<LedgerEvent> = {}): LedgerEvent => ({
  id: `${rule}-${ago}-${points}-${Math.random()}`,
  ts: NOW - ago,
  session: 's1',
  agent: 'enigma',
  repo: 'r',
  branch: 'b',
  points,
  rule,
  reason: rule,
  evidence: {},
  source: 'hook',
  by: 'hook',
  scope: 'agent',
  ...over,
})

const text = (events: LedgerEvent[], strict: string[] = []) =>
  reminderText(fold(events, [], NOW, 7), events, 'enigma', strict, NOW, 7)

test('clean window is empty', () => {
  expect(text([])).toBe('')
  expect(text([ev(RULE, -1, 10 * DAY)])).toBe('')
  expect(text([ev('x', -1, HOUR, { agent: 'other' })])).toBe('')
})

test('balance, pool, xp and level lead', () => {
  const out = text([ev(RULE, -12, HOUR), ev('good', 5, HOUR, { source: 'snj' })])
  expect(out.split('\n')[0]).toBe('Your points: 493 (-7). Team pool: 4993 (-7). XP 5, level 0.')
  expect(out).toContain('Merit: verified work done right first time')
})

test('top rules capped at 5, worst first', () => {
  const events = ['a', 'b', 'c', 'd', 'e', 'f'].map((r, i) => ev(`rule-${r}`, -(i + 1), HOUR))
  const lost = text(events).split('\n').find(l => l.startsWith('Demerits:')) ?? ''
  const rules = lost.replace(/^Demerits: /, '').replace(/\.$/, '').split(', ')
  expect(rules.length).toBe(5)
  expect(rules[0]).toBe('rule-f 1x')
  expect(lost).not.toContain('rule-a')
  expect(text([ev('r', -1, 3 * HOUR), ev('r', -1, 2 * HOUR), ev('r', -1, 2 * HOUR)])).toContain('r 3x (last 2h ago)')
})

test('strict line shown', () => {
  const out = text([ev(RULE, -1, HOUR)], [RULE])
  expect(out).toContain('Strict now: commit-without-ask (git commit/push ask first).')
  expect(text([ev(RULE, -1, HOUR)])).not.toContain('Strict now')
})

test('pool-only events still show', () => {
  expect(text([ev('team', 3, HOUR, { scope: 'pool', source: 'snj' })])).toContain('Team pool: 5003 (+3)')
})

test('tone has no threat words and stays short', () => {
  const events = [ev(RULE, -3, HOUR), ev(RULE, -3, 2 * HOUR), ev(RULE, -3, 3 * HOUR)]
  const out = text(events, [RULE])
  expect(out).not.toMatch(/pain|threat|punish|penalt|suffer|hurt|warn|fail/i)
  expect(out.split('\n').length).toBeLessThanOrEqual(6)
})

test('status line shows balance and week gains and losses', () => {
  const events = [ev('x', -8, HOUR), ev('y', 20, HOUR, { source: 'snj' })]
  expect(statusText(fold(events, [], NOW, 7), 'enigma')).toBe('Points: 512  Merit: +20  Demerit: -8')
})

test('prompt hook adds context and status, silent when clean', async () => {
  let status: string | undefined
  const run = async (lines: LedgerEvent[]) => {
    const $ = {
      clock: { now: async () => NOW },
      env: { get: async () => '/h' },
      session: { id: async () => 'enigma' },
      ui: { status: (t: string | undefined) => { status = t } },
      fs: { exists: async (p: string) => p.endsWith('ledger.jsonl'), read: async () => lines.map(l => JSON.stringify(l)).join('\n') },
    }
    return reminderPromptSubmit($ as never, { text: 'hi' }, e => e, {})
  }
  const clean = await run([])
  expect(clean.context).toBeUndefined()
  expect(status).toBe('Points: 500  Merit: +0  Demerit: -0')
  const dirty = await run([ev(RULE, -1, HOUR)])
  expect(dirty.context[0]).toContain('Demerits: commit-without-ask 1x.')
  expect(status).toBe('Points: 499  Merit: +0  Demerit: -1')
})

test('guideline is short and names merit and demerit', () => {
  expect(GUIDELINE.split('\n').length).toBeLessThan(12)
  expect(GUIDELINE).toContain('ignoring a stop')
  expect(GUIDELINE).not.toContain('demerit points')
})
