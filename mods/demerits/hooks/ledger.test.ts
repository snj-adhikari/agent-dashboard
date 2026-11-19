import { expect, test } from 'claude-code/testing'
import { appendArgv, identityOf, normalise, parseLines, resolveLedgerDir, ruleFor, slugify, type LedgerEvent } from './ledger'

const event = (over: Partial<LedgerEvent> = {}): LedgerEvent => ({
  id: 'e1',
  ts: 1,
  session: 's1',
  agent: 'hopper',
  repo: 'agent-monitor',
  branch: 'feat/demerits',
  points: -3,
  rule: ruleFor('committed without asking'),
  reason: 'committed without asking',
  evidence: { lastTool: 'Bash', lastAssistant: 'x'.repeat(500) },
  source: 'snj',
  by: 'snj',
  scope: 'agent',
  ...over,
})

test('an appended line has the full event shape and clipped evidence', () => {
  const argv = appendArgv('/h/.claude/demerits/ledger.jsonl', normalise(event()), ['/h/.claude/demerits-state'])
  expect(argv.slice(0, 2)).toEqual(['/bin/sh', '-c'])
  expect(argv[2]).toContain('>> "$file"')
  expect(argv[2]).toContain('mkdir -p "$(dirname "$file")" "$@"')
  expect(argv.slice(5)).toEqual(['/h/.claude/demerits/ledger.jsonl', '/h/.claude/demerits-state'])
  expect(argv[4].includes('\n')).toBe(false)
  const rows = parseLines<LedgerEvent>(`${argv[4]}\n${JSON.stringify(normalise(event({ id: 'e2', points: 5 })))}\n`)
  expect(rows.map(r => r.id)).toEqual(['e1', 'e2'])
  expect(Object.keys(rows[0]).sort()).toEqual(
    ['agent', 'branch', 'by', 'evidence', 'id', 'points', 'reason', 'repo', 'rule', 'scope', 'session', 'source', 'ts'],
  )
  expect(rows[0].rule).toBe('commit-without-ask')
  expect(rows[0].evidence.lastAssistant?.length).toBe(300)
  expect(rows[0].evidence.lastTool).toBe('Bash')
})

test('a missing trailing newline and a corrupt line do not break the ledger', () => {
  const rows = parseLines<LedgerEvent>('{"id":"a"}\nnot json\n{"id":"b"}')
  expect(rows.map(r => r.id)).toEqual(['a', 'b'])
})

test('ledgerDir option is honoured, ~ expands, default applies when unset', () => {
  expect(resolveLedgerDir({ ledgerDir: '/abs/dir/' }, '/h')).toBe('/abs/dir')
  expect(resolveLedgerDir({ ledgerDir: '~/notes/points' }, '/h')).toBe('/h/notes/points')
  expect(resolveLedgerDir({}, '/h')).toBe('/h/.claude/demerits')
  expect(resolveLedgerDir({ ledgerDir: '  ' }, '/h')).toBe('/h/.claude/demerits')
})

test('a reason matching a seeded rule or a known slug reuses it', () => {
  expect(ruleFor('3 commits without asking first')).toBe('commit-without-ask')
  expect(ruleFor('blocked by TAMPER guard')).toBe('tamper')
  expect(ruleFor('added Co-Authored-By trailer')).toBe('attribution')
  expect(ruleFor('was late to standup again', ['late-standup'])).toBe('late-standup')
})

test('an unmatched reason falls back to slugify', () => {
  expect(ruleFor('Left console.log in prod!', ['late-standup'])).toBe('left-console-log-in-prod')
  expect(slugify('  ** ')).toBe('unspecified')
  expect(slugify('one two three four five six seven')).toBe('one-two-three-four-five-six')
})

test('identity is the codename, else the session id', () => {
  expect(identityOf('hopper', 's1')).toBe('hopper')
  expect(identityOf(undefined, 's1')).toBe('s1')
  expect(identityOf('  ', 's1')).toBe('s1')
})
