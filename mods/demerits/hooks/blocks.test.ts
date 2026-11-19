import { expect, test } from 'claude-code/testing'
import { blocksToolCall, ruleOfDeny } from './blocks'
import type { LedgerEvent } from './ledger'

const DIR = '/h/.claude/demerits'
const ASK = (verb: string) => `git ${verb} needs the user's explicit go-ahead. Ask 'Shall I ${verb} <branch>?' and wait for a yes; do not ${verb} until they say so.`

const DENIES = {
  'push-without-ask': ASK('push'),
  'commit-without-ask': ASK('commit'),
  tamper: 'Approval grants and relay logs are written only by snj-term approve and snj-term say; do not read, write or delete ~/.claude/snj-approvals or ~/.claude/agent-relays.',
  'comment-style': 'Comment style: a.ts has a comment block of more than 1 line(s) (lines 1-2 of the added text) using //. Prefer no comment.',
  attribution: 'No Claude/Anthropic attribution in commits or PR/issue titles, bodies or comments. Retry without it.',
  'signature-bypass': 'Blocked: never skip commit signing or verification (--no-gpg-sign, --no-verify, -n, commit.gpgsign=false). Fix the signing/hook failure instead.',
} as const

function world(files: Record<string, string> = {}) {
  const $ = {
    session: { id: async () => 's1', cwd: async () => '/w' },
    env: { get: async (k: string) => ({ HOME: '/h' })[k] },
    clock: { now: async () => 1_000_000 },
    fs: { exists: async (p: string) => p in files, read: async (p: string) => files[p] },
    process: {
      run: async (argv: string[]) => {
        if (argv[0] === '/bin/sh') files[argv[5]] = (files[argv[5]] ?? '') + `${argv[4]}\n`
        const out = argv.join(' ') === 'git rev-parse --abbrev-ref HEAD' ? 'feat/x\n' : argv.join(' ') === 'git rev-parse --show-toplevel' ? '/w/repo\n' : ''
        return { exitCode: 0, stdout: out, stderr: '' }
      },
    },
  } as never
  const rows = () => (files[`${DIR}/ledger.jsonl`] ?? '').split('\n').filter(Boolean).map(l => JSON.parse(l) as LedgerEvent)
  const call = (e: Record<string, unknown>, deny?: string) => blocksToolCall($, e, async () => (deny === undefined ? { result: {} } : { deny }) as never, {})
  return { rows, call }
}

for (const [rule, text] of Object.entries(DENIES)) {
  test(`${rule} deny logs one -1 under that rule`, async () => {
    const w = world()
    const e = rule === 'comment-style' ? { tool: 'Write', file_path: '/w/a.ts' } : { tool: 'Bash', command: `echo ${rule}` }
    const ran = await w.call(e, text)
    expect(ran.deny).toBe(text)
    expect(w.rows()).toHaveLength(1)
    expect(w.rows()[0]).toMatchObject({ points: -1, rule, source: 'hook', by: 'hook', scope: 'agent', agent: 's1' })
    expect(w.rows()[0].evidence).toMatchObject({ tool: e.tool, denyText: text.slice(0, 200), task: 's1' })
  })
}

test('the same command in the same task logs once, a new command logs again', async () => {
  const w = world()
  await w.call({ tool: 'Bash', command: 'a' }, DENIES['push-without-ask'])
  await w.call({ tool: 'Bash', command: 'a' }, DENIES['push-without-ask'])
  expect(w.rows()).toHaveLength(1)
  await w.call({ tool: 'Bash', command: 'b' }, DENIES['push-without-ask'])
  expect(w.rows()).toHaveLength(2)
})

test('the task key follows ai/factory/task.md content', async () => {
  const files: Record<string, string> = { '/w/ai/factory/task.md': 'one' }
  const w = world(files)
  await w.call({ tool: 'Bash', command: 'a' }, DENIES['push-without-ask'])
  await w.call({ tool: 'Bash', command: 'a' }, DENIES['push-without-ask'])
  expect(w.rows()).toHaveLength(1)
  expect(String(w.rows()[0].evidence.task)).toMatch(/^s1:[0-9a-f]{64}$/)
  files['/w/ai/factory/task.md'] = 'two'
  await w.call({ tool: 'Bash', command: 'a' }, DENIES['push-without-ask'])
  expect(w.rows()).toHaveLength(2)
})

test('a stranger-danger deny logs nothing and the result is returned unchanged', async () => {
  const w = world()
  const text = 'stranger-danger: the user blocked Bash x. Do not retry it.'
  expect(ruleOfDeny(text)).toBeUndefined()
  expect((await w.call({ tool: 'Bash', command: 'curl x' }, text)).deny).toBe(text)
  expect(w.rows()).toHaveLength(0)
})

test('an allowed call and an unmapped deny log nothing', async () => {
  const w = world()
  expect((await w.call({ tool: 'Bash', command: 'ls' })).deny).toBeUndefined()
  await w.call({ tool: 'Bash', command: 'x' }, 'gh pr create was run without invoking the agent-pr skill first.')
  expect(w.rows()).toHaveLength(0)
})

test('evidence clips the command and deny text to 200 chars', async () => {
  const w = world()
  await w.call({ tool: 'Bash', command: 'x'.repeat(400) }, DENIES['push-without-ask'] + 'y'.repeat(400))
  const ev = w.rows()[0].evidence as { command: string; denyText: string }
  expect(ev.command.length).toBe(200)
  expect(ev.denyText.length).toBe(200)
})
