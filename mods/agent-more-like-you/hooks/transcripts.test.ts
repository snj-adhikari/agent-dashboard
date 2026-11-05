import { expect, test } from 'claude-code/testing'
import { targetOf } from './audience'
import { agentWrites, aiOutputs, cleanPrompt, notesWrites, pastedSpans, redact, typedPrompts } from './transcripts'

const user = (content: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'user',
    timestamp: '2026-01-01T00:00:00Z',
    message: { role: 'user', content },
    origin: { kind: 'human' },
    promptSource: 'typed',
    ...extra,
  })
const use = (name: string, input: unknown) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-01-02T00:00:00Z',
    message: { content: [{ type: 'tool_use', name, input }] },
  })
const P = '/p/s.jsonl'
const ok = 'please fix the widget now'

test('keeps a typed human prompt', () => {
  expect(typedPrompts([user(ok)], P)).toEqual([{ text: ok, ts: '2026-01-01T00:00:00Z' }])
})

test('drops sidechain, meta, subagent path, non-string, non-typed, short and slash-only', () => {
  const lines = [
    user(ok, { isSidechain: true }),
    user(ok, { isMeta: true }),
    user([{ type: 'text', text: ok }]),
    user(ok, { promptSource: 'sdk' }),
    user('two words'),
    user('/clear'),
  ]
  expect(typedPrompts(lines, P)).toEqual([])
  expect(typedPrompts([user(ok)], '/p/subagents/a.jsonl')).toEqual([])
})

test('drops each excluded marker and prefix', () => {
  const marked = [
    '<command-name>x</command-name> a b c',
    '<local-command-stdout>a b c',
    '<bash-input>a b c',
    '<task-notification>a b c',
    '<system-reminder>a b c',
    'The factory plugin sent a message a b c',
    'Base directory for this skill a b c',
    '[Request interrupted by user] a b c',
    'You are the factory dev a b c',
    'Finished: a b c d',
    '[subtab one] a b c',
    'STOP: a b c d',
  ]
  expect(typedPrompts(marked.map((m) => user(m)), P)).toEqual([])
})

test('strips pasted blocks and drops when too little remains', () => {
  const pasted = user(`${ok} <pasted_content id="1">blob blob blob</pasted_content> [Pasted text #2 +5 lines]`)
  expect(typedPrompts([pasted], P)[0].text).toBe(ok)
  expect(typedPrompts([user('hi [Pasted text #1 +9 lines] there')], P)).toEqual([])
})

test('legacy records: kept without toolUseResult, dropped with it', () => {
  const legacy = (extra: Record<string, unknown>) =>
    JSON.stringify({ type: 'user', timestamp: 't', message: { content: ok }, ...extra })
  expect(typedPrompts([legacy({})], P)).toHaveLength(1)
  expect(typedPrompts([legacy({ toolUseResult: {} })], P)).toEqual([])
})

test('extracts slack, jira, executeWrite and confluence writes', () => {
  const slack = { channel_id: 'C1', thread_ts: '1.2', message: 'hello there' }
  const jira = { issueIdOrKey: 'ABC-1', commentBody: 'looks fine' }
  const lines = [
    use('mcp__x__slack_send_message_draft', slack),
    use('mcp__x__addOrEditJiraIssueComment', jira),
    use('mcp__x__executeWrite', { name: 'addOrEditJiraIssueComment', inputs: jira }),
    use('mcp__x__createConfluenceFooterComment', { body: '<p>a &amp; b</p><p>c</p>' }),
    use('mcp__x__createConfluenceInlineComment', { edits: [{ value: '<b>x</b>' }] }),
    use('mcp__x__createJiraIssue', { summary: 'nope' }),
  ]
  const w = agentWrites(lines)
  expect(w.map((x) => x.tool)).toEqual([
    'mcp__x__slack_send_message_draft',
    'mcp__x__addOrEditJiraIssueComment',
    'addOrEditJiraIssueComment',
    'mcp__x__createConfluenceFooterComment',
    'mcp__x__createConfluenceInlineComment',
  ])
  expect(w[0]).toEqual({ tool: w[0].tool, target: targetOf(w[0].tool, slack), text: 'hello there', ts: '2026-01-02T00:00:00Z' })
  expect(w[1].text).toBe('looks fine')
  expect(w[2].text).toBe('looks fine')
  expect(w[3].text).toBe('a & b\nc')
  expect(w[4].text).toBe('x')
})

test('extracts each gh body form and ignores non-comment gh', () => {
  const cmds = [
    'gh api repos/o/r/issues/1/comments -f body="via f"',
    "gh api repos/o/r/issues/1/comments -F body='via F'",
    'gh api repos/o/r/issues/1/comments --field body=viafield',
    'gh api repos/o/r/issues/1/comments --raw-field body="via raw"',
    'gh pr comment 1 --body "via body"',
    'gh pr comment 1 -b "via b"',
    'gh pr review 1 --body="via eq"',
    "gh pr comment 1 --body \"$(cat <<'EOF'\nline one\nline two\nEOF\n)\"",
    'gh pr view 1',
  ]
  const w = agentWrites(cmds.map((command) => use('Bash', { command })))
  expect(w.map((x) => x.text)).toEqual([
    'via f',
    'via F',
    'viafield',
    'via raw',
    'via body',
    'via b',
    'via eq',
    'line one\nline two',
  ])
})

test('extracts slack_send_message and keeps null-target writes with empty target', () => {
  const w = agentWrites([
    use('mcp__x__slack_send_message', { channel_id: 'C1', message: 'sent text' }),
    use('Bash', { command: 'gh pr comment --body "no target here"' }),
  ])
  expect(w.map((x) => [x.target, x.text])).toEqual([['C1:', 'sent text'], ['', 'no target here']])
})

test('cleanPrompt filters a raw prompt and pastedSpans returns pasted bodies', () => {
  expect(cleanPrompt(`${ok} [Pasted text #1 +3 lines]`)).toBe(ok)
  expect(cleanPrompt('<system-reminder>a b c')).toBeNull()
  expect(cleanPrompt('/clear')).toBeNull()
  expect(pastedSpans('x <pasted_content id="1">first body</pasted_content> y <pasted_content>second</pasted_content>')).toEqual(['first body', 'second'])
})

test('redact masks secret-shaped spans only', () => {
  const t = 'use sk-abcdefghijklmnop and Bearer abc.def-123 with api_key = hunter2 or ' + 'a'.repeat(40) + ' plus eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl ok'
  const r = redact(t)
  expect(r).not.toMatch(/sk-abc|hunter2|aaaaaaaa|eyJ|abc\.def/)
  expect(r).toContain('use [redacted]')
  expect(redact('plain words stay as they are')).toBe('plain words stay as they are')
})

test('notesWrites keeps Write, Edit and MultiEdit under the notes dir only', () => {
  const w = notesWrites(
    [
      use('Write', { file_path: '/n/a.md', content: 'written text' }),
      use('Edit', { file_path: '/n/b.md', new_string: 'edited text' }),
      use('MultiEdit', { file_path: '/n/c.md', edits: [{ new_string: 'one' }, { new_string: 'two' }] }),
      use('Write', { file_path: '/other/d.md', content: 'elsewhere' }),
      use('Read', { file_path: '/n/e.md' }),
    ],
    '/n',
  )
  expect(w.map((x) => [x.target, x.text])).toEqual([['/n/a.md', 'written text'], ['/n/b.md', 'edited text'], ['/n/c.md', 'one\n\ntwo']])
})

test('aiOutputs gathers assistant text, tool_use strings and Agent results only', () => {
  const asst = (content: unknown[]) => JSON.stringify({ type: 'assistant', timestamp: 't1', message: { content } })
  const result = (id: string, text: string) =>
    JSON.stringify({ type: 'user', timestamp: 't2', message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }] }] } })
  const out = aiOutputs([
    asst([{ type: 'text', text: 'assistant says hi' }, { type: 'tool_use', id: 'a1', name: 'Agent', input: { prompt: 'do the thing', opts: { note: 'nested' } } }]),
    asst([{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'ls' } }]),
    result('a1', 'subagent report'),
    result('b1', 'bash output'),
  ]).map((o) => o.text)
  expect(out).toEqual(['assistant says hi', 'do the thing', 'nested', 'ls', 'subagent report'])
})
