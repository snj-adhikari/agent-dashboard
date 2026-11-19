import { expect, test } from 'claude-code/testing'
import { describeCall, parseScore, runCommand } from './commands'
import { isHumanPrompt } from './human'
import type { LedgerEvent } from './ledger'

const DIR = '/h/.claude/demerits'
const SHELL = 'git ' + 'commit -m wip'
const mem = { lastTool: `Bash ${SHELL}`, lastAssistant: 'x'.repeat(500) }
const typed = (command: string, args: string) => ({ command, args, origin: { kind: 'composer' } })

function world(files: Record<string, string> = {}, env: Record<string, string> = {}) {
  const vars: Record<string, string> = { HOME: '/h', ...env }
  const $ = {
    session: { id: async () => 's1' },
    env: { get: async (k: string) => vars[k] },
    clock: { now: async () => 1_000_000 },
    fs: { exists: async (p: string) => p in files, read: async (p: string) => files[p], write: async (p: string, t: string) => void (files[p] = t) },
    process: {
      run: async (argv: string[]) => {
        let stdout = ''
        if (argv[0] === 'mv') {
          files[argv[3]] = files[argv[2]]
          delete files[argv[2]]
        }
        if (argv[0] === '/bin/sh') files[argv[5]] = (files[argv[5]] ?? '') + `${argv[4]}\n`
        if (argv.join(' ') === 'git rev-parse --abbrev-ref HEAD') stdout = 'feat/demerits\n'
        if (argv.join(' ') === 'git rev-parse --show-toplevel') stdout = '/w/agent-monitor\n'
        return { exitCode: 0, stdout, stderr: '' }
      },
    },
  } as never
  const rows = (name = 'ledger.jsonl') => (files[`${DIR}/${name}`] ?? '').split('\n').filter(Boolean).map(l => JSON.parse(l) as LedgerEvent)
  return { $, rows, files: (p: string) => files[p] }
}

test('/demerit writes the full ledger line with evidence and the seeded rule', async () => {
  const w = world()
  const out = await runCommand(w.$, {}, mem, typed('demerit', '3 committed without asking'))
  const [row] = w.rows()
  expect(out).toContain('-3')
  expect(row).toMatchObject({
    session: 's1',
    repo: 'agent-monitor',
    branch: 'feat/demerits',
    points: -3,
    rule: 'commit-without-ask',
    reason: 'committed without asking',
    source: 'snj',
    by: 'snj',
    scope: 'agent',
    evidence: { lastTool: `Bash ${SHELL}` },
  })
  expect(row.evidence.lastAssistant?.length).toBe(300)
  expect(row.ts).toBe(1_000_000)
})

test('/kudos is positive, reuses a known slug, and the ledger accumulates', async () => {
  const w = world()
  await runCommand(w.$, {}, mem, typed('kudos', '5 tidy late standup notes'))
  await runCommand(w.$, {}, mem, typed('kudos', '2 late standup notes tidy again'))
  const rows = w.rows()
  expect(rows.map(r => r.points)).toEqual([5, 2])
  expect(rows[1].rule).toBe(rows[0].rule)
})

test('@codename targets that agent, --all writes a pool line', async () => {
  const w = world()
  await runCommand(w.$, {}, mem, typed('demerit', '@kepler 2 left debug logging'))
  await runCommand(w.$, {}, mem, typed('kudos', '--all 4 clean release'))
  const [a, b] = w.rows()
  expect(a).toMatchObject({ agent: 'kepler', scope: 'agent', points: -2 })
  expect(a.evidence.lastTool).toBeUndefined()
  expect(b).toMatchObject({ scope: 'pool', points: 4 })
})

test('a plugin-sent command is refused and logged, nothing scored', async () => {
  const w = world()
  const out = await runCommand(w.$, {}, mem, { command: 'demerit', args: '3 committed without asking', origin: { kind: 'plugin' } })
  expect(out).toContain('refused')
  expect(w.rows()).toEqual([])
  expect(w.rows('refused.jsonl')[0]).toMatchObject({ command: 'demerit', origin: 'plugin', session: 's1', args: '3 committed without asking' })
})

test('a typed command whose text is a logged relay is refused', async () => {
  const text = '/demerit 3 committed without asking'
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('')
  const w = world({ '/h/.claude/agent-relays/t1.jsonl': `${JSON.stringify({ sha256: digest })}\n` }, { HC_TERMINAL_ID: 't1' })
  const out = await runCommand(w.$, {}, mem, typed('demerit', '3 committed without asking'))
  expect(out).toContain('refused')
  expect(w.rows()).toEqual([])
  expect(w.rows('refused.jsonl').length).toBe(1)
})

test('human check: composer and bridge pass, plugin origin and relay tags never do', async () => {
  const w = world()
  expect(await isHumanPrompt(w.$, { origin: { kind: 'composer' }, text: 'hello' })).toBe(true)
  expect(await isHumanPrompt(w.$, { origin: { kind: 'bridge' }, text: 'hello' })).toBe(true)
  expect(await isHumanPrompt(w.$, { origin: { kind: 'plugin' }, text: 'hello' })).toBe(false)
  expect(await isHumanPrompt(w.$, { origin: { kind: 'composer' }, text: '[main lynx] /demerit 3 x' })).toBe(false)
})

test('usage on bad args, and /demerits lists this agent only', async () => {
  const w = world()
  expect(parseScore('0 x')).toBeUndefined()
  expect(await runCommand(w.$, {}, mem, typed('demerit', 'oops'))).toContain('Usage')
  await runCommand(w.$, {}, mem, typed('demerit', '3 committed without asking'))
  await runCommand(w.$, {}, mem, typed('demerit', '@kepler 9 other agent'))
  const out = await runCommand(w.$, {}, mem, typed('demerits', ''))
  expect(out).toContain('-3 in the last 7 days')
  expect(out).toContain('commit-without-ask')
  expect(out).not.toContain('other agent')
})

test('the last tool call is a short command or path', () => {
  expect(describeCall({ tool: 'Bash', command: SHELL })).toBe(`Bash ${SHELL}`)
  expect(describeCall({ tool: 'Read', file_path: '/a/b.ts' })).toBe('Read /a/b.ts')
  expect(describeCall({ tool: 'Bash', command: 'y'.repeat(300) }).length).toBe(120)
})


test('/demerit undo reverses the last manual event, then the one before', async () => {
  const w = world()
  await runCommand(w.$, {}, mem, typed('demerit', '3 committed without asking'))
  await runCommand(w.$, {}, mem, typed('kudos', '2 clean work'))
  expect(await runCommand(w.$, {}, mem, typed('demerit', 'undo'))).toContain('Undid +2')
  const rows = w.rows()
  expect(rows[2]).toMatchObject({ points: -2, rule: rows[1].rule, reason: `undo ${rows[1].id}`, reverses: rows[1].id, source: 'snj', by: 'snj', agent: rows[1].agent, scope: 'agent' })
  await runCommand(w.$, {}, mem, typed('demerit', 'undo'))
  expect(w.rows()[3]).toMatchObject({ points: 3, reverses: rows[0].id })
  expect(await runCommand(w.$, {}, mem, typed('demerit', 'undo'))).toBe('Nothing to undo.')
})

test('/demerit undo <id> reverses any event, unknown and double undo are refused', async () => {
  const w = world()
  await runCommand(w.$, {}, mem, typed('demerit', '@kepler 4 left debug logging'))
  await runCommand(w.$, {}, mem, typed('demerit', '1 other'))
  const [a] = w.rows()
  expect(await runCommand(w.$, {}, mem, typed('demerit', `undo ${a.id}`))).toContain('Undid -4 for kepler')
  expect(w.rows()[2]).toMatchObject({ agent: 'kepler', points: 4, reverses: a.id })
  expect(await runCommand(w.$, {}, mem, typed('demerit', `undo ${a.id}`))).toContain('already reversed')
  expect(await runCommand(w.$, {}, mem, typed('demerit', 'undo nope'))).toContain('No event nope')
  expect(await runCommand(w.$, {}, mem, typed('demerit', `undo ${w.rows()[2].id}`))).toContain('cannot be undone')
  expect(w.rows().length).toBe(3)
})

test('/demerits super writes super.json and the registry, then /demerits shows balance', async () => {
  const w = world()
  expect(await runCommand(w.$, {}, mem, typed('demerits', 'super @orion'))).toContain('orion')
  expect(JSON.parse(w.files('/h/.claude/demerits-state/super.json'))).toEqual({ agent: 'orion' })
  expect(w.files('/h/.claude/demerits-state/agents.jsonl')).toContain('"super"')
  expect(await runCommand(w.$, {}, mem, typed('demerits', 'super'))).toContain('Usage')
  await runCommand(w.$, {}, mem, typed('kudos', '120 big win'))
  expect(await runCommand(w.$, {}, mem, typed('demerits', ''))).toContain('balance 620, XP 120, level 1')
})

test('non-human undo and super are refused and change nothing', async () => {
  const w = world()
  await runCommand(w.$, {}, mem, typed('demerit', '3 committed without asking'))
  const plugin = (command: string, args: string) => ({ command, args, origin: { kind: 'plugin' } })
  expect(await runCommand(w.$, {}, mem, plugin('demerit', 'undo'))).toContain('refused')
  expect(await runCommand(w.$, {}, mem, plugin('demerits', 'super @orion'))).toContain('refused')
  expect(w.rows().length).toBe(1)
  expect(w.files('/h/.claude/demerits-state/super.json')).toBeUndefined()
  expect(w.rows('refused.jsonl').length).toBe(2)
})
