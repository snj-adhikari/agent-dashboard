import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const H = '/h'
const F = `${H}/.claude/more-like-you`
const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-11-05T10:00:00Z')
const TODAY = '2026-11-05'
const PROFILE = `# Style profile
## Slack DM
Lowercase, one line, no greeting.
## Slack channel
Short bullets, name the owner.
## Jira
Plain sentences, link the PR.
## GitHub PR
Terse, imperative.
## Confluence
insufficient samples
`
const RULES = `## Jira
- keep it to two lines (seen 2)
### Edits
- Cut drafts to about 40% of the draft length
`
const SLACK_BLOCK = (user: string, text: string, ts = '1762246800.000100') => `From: Person (ID: ${user})\nChannel: general (ID: C1)\nMessage_ts: ${ts}\nText: ${text}`
let n = 0
const bottom = { result: 'ok' }

interface World {
  files: Map<string, string>
  runs: string[][]
  fetched: string[]
}

const settings = (vaultPath: string) => ({ ok: true, status: 200, headers: {}, text: JSON.stringify({ ok: true, settings: { vaultPath } }) })
const down = { ok: false, status: 503, headers: {}, text: '' }

function world(on: On, files: Record<string, string>, env: Record<string, string> = {}, fetched: () => unknown = () => ({ value: down })) {
  const w: World = { files: new Map(Object.entries(files)), runs: [], fetched: [] }
  mock.env(on, { HOME: H, ...env })
  const clock = mock.clock(on, { now: NOW })
  bottom.result = 'ok'
  const id = `s${++n}`
  on('session.id', () => ({ value: id }))
  on('fs.exists', (_$, e) => ({ value: w.files.has(e.path) || [...w.files.keys()].some((k) => k.startsWith(`${e.path}/`)) }))
  on('fs.read', (_$, e) => ({ value: w.files.get(e.path) ?? '' }))
  on('fs.write', (_$, e) => (w.files.set(e.path, e.text), { value: undefined }))
  on('fs.list', (_$, e) => ({
    value: [...w.files.keys()].filter((k) => k.startsWith(`${e.path}/`)).map((k) => ({ name: k.slice(e.path.length + 1), kind: 'file' as const })),
  }) as never)
  on('http.fetch', (_$, e) => (w.fetched.push(e.url), fetched()) as never)
  on('process.run', (_$, e) => (w.runs.push([...e.argv]), { value: { exitCode: 0, stdout: '', stderr: '' } }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))
  on('tool.call', () => ({ result: bottom.result }) as never)
  on('tool.register', () => ({ value: undefined }) as never)
  return { ...w, clock }
}

const call = ($: any, tool: string, input: Record<string, unknown>) => $.tool.call({ tool, ...input })
const draft = (channel_id: string, message = 'hi') => ({ channel_id, message })
const typed = (text: string) => ({ text, origin: { kind: 'composer' } }) as never
const rawFile = (w: { files: Map<string, string> }, kind: string) => w.files.get(`${F}/raw/${TODAY}-${kind}.jsonl`)
const lines = (s: string | undefined) => (s ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l))
const profile = { [`${F}/style-profile.md`]: PROFILE }

test('slack DM is denied once with precedence and the DM section, then allowed', async ($, on) => {
  world(on, profile)
  const first = await call($, 'mcp__slack__slack_send_message_draft', draft('D123'))
  expect(first.deny).toContain('Lowercase, one line, no greeting.')
  expect(first.deny).toContain('stop-slop')
  expect(first.deny).not.toContain('Short bullets')
  expect((await call($, 'mcp__slack__slack_send_message_draft', draft('D123'))).result).toBe('ok')
})

test('slack_send_message is gated the same way', async ($, on) => {
  world(on, profile)
  expect((await call($, 'mcp__slack__slack_send_message', draft('D123'))).deny).toContain('Lowercase')
  expect((await call($, 'mcp__slack__slack_send_message', draft('D123'))).result).toBe('ok')
})

test('rules and Edits come before the profile in the deny text', async ($, on) => {
  world(on, { ...profile, [`${F}/rules.md`]: RULES })
  const { deny } = await call($, 'mcp__atlassian__addOrEditJiraIssueComment', { issueIdOrKey: 'X-1' })
  expect(deny.indexOf('keep it to two lines')).toBeLessThan(deny.indexOf('Plain sentences'))
  expect(deny.indexOf('### Edits')).toBeLessThan(deny.indexOf('Plain sentences'))
})

test('rules alone still gate', async ($, on) => {
  world(on, { [`${F}/rules.md`]: RULES })
  expect((await call($, 'mcp__atlassian__addOrEditJiraIssueComment', {})).deny).toContain('keep it to two lines')
})

test('no profile and no rules never denies', async ($, on) => {
  world(on, {})
  expect((await call($, 'mcp__slack__slack_send_message_draft', draft('D1'))).result).toBe('ok')
})

test('an insufficient section never denies', async ($, on) => {
  world(on, profile)
  const input = { name: 'createConfluenceFooterComment', inputs: { pageId: '1' } }
  expect((await call($, 'mcp__atlassian__executeWrite', input)).result).toBe('ok')
})

test('an audience disabled in config passes', async ($, on) => {
  world(on, { ...profile, [`${F}/config.json`]: JSON.stringify({ audiences: { 'slack-dm': false } }) })
  expect((await call($, 'mcp__slack__slack_send_message_draft', draft('D1'))).result).toBe('ok')
  expect((await call($, 'mcp__slack__slack_send_message_draft', draft('C1'))).deny).toBeDefined()
})

test('MORE_LIKE_YOU_CHILD=1 never denies', async ($, on) => {
  world(on, profile, { MORE_LIKE_YOU_CHILD: '1' })
  expect((await call($, 'mcp__slack__slack_send_message_draft', draft('D1'))).result).toBe('ok')
})

test('folder follows MORE_LIKE_YOU_VAULT', async ($, on) => {
  world(on, { '/custom/style-profile.md': PROFILE }, { MORE_LIKE_YOU_VAULT: '/custom' })
  expect((await call($, 'mcp__slack__slack_send_message_draft', draft('D1'))).deny).toContain('Lowercase')
})

test('dashboard vaultPath is used', async ($, on) => {
  const ok = world(on, { '/v/more-like-you/style-profile.md': PROFILE }, {}, () => ({ value: settings('/v') }))
  expect((await call($, 'mcp__slack__slack_send_message_draft', draft('D1'))).deny).toContain('Lowercase')
  expect(ok.fetched).toEqual(['http://127.0.0.1:5818/api/settings'])
})

test('a hung dashboard times out to ~/.claude/more-like-you', async ($, on) => {
  const w = world(on, profile, {}, () => new Promise(() => {}))
  const pending = call($, 'mcp__slack__slack_send_message_draft', draft('D1'))
  await w.clock.advance(800)
  expect((await pending).deny).toContain('Lowercase')
})

test('prompt capture writes a redacted line and never blocks', async ($, on) => {
  const w = world(on, {})
  const key = `sk-${'a1B2c3D4e5F6g7H8i9J0'}`
  const token = `ghp_${'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'}`
  const out = await $.prompt.submit(typed(`please use ${key} and ${token} for the check today`))
  expect(out.text).toContain('sk-')
  const [row] = lines(rawFile(w, 'prompts'))
  expect(row.source).toBe('prompts')
  expect(row.text).toContain('[redacted]')
  expect(row.text).not.toContain(key)
  expect(row.text).not.toContain(token)
})

test('non-human origin and disabled prompts are not captured', async ($, on) => {
  const w = world(on, {})
  await $.prompt.submit({ text: 'run the nightly check on the staging box', origin: { kind: 'task-notification' } } as never)
  expect(rawFile(w, 'prompts')).toBeUndefined()
})

test('sources.prompts=false disables capture', async ($, on) => {
  const w = world(on, { [`${F}/config.json`]: JSON.stringify({ sources: { prompts: false } }) })
  await $.prompt.submit(typed('run the nightly check on the staging box'))
  expect(rawFile(w, 'prompts')).toBeUndefined()
})

test('a pasted span is captured as pasted/unknown', async ($, on) => {
  const w = world(on, {})
  await $.prompt.submit(typed('see this one <pasted_content>the third quarter plan is fine</pasted_content> thanks mate'))
  const rows = lines(rawFile(w, 'prompts'))
  expect(rows.find((r) => r.source === 'pasted')).toEqual(expect.objectContaining({ author: 'unknown', text: 'the third quarter plan is fine' }))
})

test('feedback is logged after a gated draft, once, and not without one', async ($, on) => {
  const w = world(on, profile)
  await $.prompt.submit(typed('make it shorter and drop the greeting please'))
  expect(rawFile(w, 'feedback')).toBeUndefined()
  const cmd = draft('D1', 'hello there, a long message')
  await call($, 'mcp__slack__slack_send_message_draft', cmd)
  await call($, 'mcp__slack__slack_send_message_draft', cmd)
  await $.prompt.submit(typed('make it shorter and drop the greeting please'))
  await $.prompt.submit(typed('another unrelated instruction for later'))
  const rows = lines(rawFile(w, 'feedback'))
  expect(rows).toHaveLength(1)
  expect(rows[0]).toEqual(expect.objectContaining({ audience: 'slack-dm', instruction: 'make it shorter and drop the greeting please', before: 'hello there, a long message' }))
})

test('a short instruction after a gated draft is still feedback', async ($, on) => {
  const w = world(on, profile)
  const cmd = draft('D2', 'hello there, a long message')
  await call($, 'mcp__slack__slack_send_message_draft', cmd)
  await call($, 'mcp__slack__slack_send_message_draft', cmd)
  await $.prompt.submit(typed('shorter'))
  expect(lines(rawFile(w, 'feedback'))[0]).toEqual(expect.objectContaining({ instruction: 'shorter' }))
})

test('post-tool observe appends self and other rows and returns the result unchanged', async ($, on) => {
  const w = world(on, { [`${F}/cursor.json`]: JSON.stringify({ identity: { slackId: 'U111' } }) })
  const result = `${SLACK_BLOCK('U111', 'mine one')}\n---\n${SLACK_BLOCK('U222', 'theirs one', '1762246900.000200')}`
  bottom.result = result
  const r = await call($, 'mcp__slack__slack_read_channel', { channel_id: 'C1' })
  expect(r.result).toBe(result)
  const rows = lines(rawFile(w, 'observed'))
  expect(rows.map((x) => x.author).sort()).toEqual(['other', 'self'])
})

test('a short instruction after a gated draft is still feedback', async ($, on) => {
  const w = world(on, profile)
  const cmd = draft('D2', 'hello there, a long message')
  await call($, 'mcp__slack__slack_send_message_draft', cmd)
  await call($, 'mcp__slack__slack_send_message_draft', cmd)
  await $.prompt.submit(typed('shorter'))
  expect(lines(rawFile(w, 'feedback'))[0]).toEqual(expect.objectContaining({ instruction: 'shorter' }))
})

test('post-tool observe captures nothing without identity', async ($, on) => {
  const w = world(on, {})
  const result = SLACK_BLOCK('U111', 'mine one')
  bottom.result = result
  expect((await call($, 'mcp__slack__slack_read_channel', { channel_id: 'C1' })).result).toBe(result)
  expect(rawFile(w, 'observed')).toBeUndefined()
})

test('nudge: missing cursor suggests learn, once per session', async ($, on) => {
  world(on, {})
  const a = await $.prompt.submit(typed('a'))
  const b = await $.prompt.submit(typed('b'))
  expect(a.context?.join('\n')).toContain('/more-like-you learn')
  expect(b.context?.join('\n') ?? '').not.toContain('more-like-you')
})

test('nudge: stale cursor suggests refresh with the captured count; fresh adds nothing', async ($, on) => {
  const stale = new Date(NOW - 8 * DAY).toISOString()
  world(on, {
    [`${F}/cursor.json`]: JSON.stringify({ updatedAt: stale }),
    [`${F}/raw/2026-11-04-prompts.jsonl`]: `${JSON.stringify({ source: 'prompts', ts: new Date(NOW - DAY).toISOString(), text: 'x' })}\n`,
  })
  const a = await $.prompt.submit({ text: 'a', origin: { kind: 'sdk' } } as never)
  expect(a.context?.join('\n')).toContain('/more-like-you refresh')
  expect(a.context?.join('\n')).toContain('1 prompts captured')
})

test('nudge: fresh cursor adds nothing', async ($, on) => {
  world(on, { [`${F}/cursor.json`]: JSON.stringify({ updatedAt: new Date(NOW - DAY).toISOString() }) })
  const b = await $.prompt.submit({ text: 'a', origin: { kind: 'sdk' } } as never)
  expect(b.context?.join('\n') ?? '').not.toContain('more-like-you')
})

const PERSPECTIVE = 'How the user thinks and why.'
const view = (a: { context?: readonly string[] }) => (a.context ?? []).find((c) => c.startsWith(PERSPECTIVE)) ?? ''

test('perspective is injected once per session', async ($, on) => {
  world(on, { [`${F}/perspective.md`]: 'Prefers small steps.\nDislikes surprises.' })
  const a = await $.prompt.submit({ text: 'a', origin: { kind: 'sdk' } } as never)
  const b = await $.prompt.submit({ text: 'b', origin: { kind: 'sdk' } } as never)
  expect(view(a)).toContain('It is not evidence that they are right')
  expect(view(a)).toContain('Dislikes surprises.')
  expect(view(b)).toBe('')
})

test('perspective is cut to 800 characters on whole lines', async ($, on) => {
  const long = Array.from({ length: 40 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n')
  world(on, { [`${F}/perspective.md`]: long })
  const body = view(await $.prompt.submit({ text: 'a', origin: { kind: 'sdk' } } as never)).split('\n').slice(1).join('\n')
  expect(body.length).toBeLessThanOrEqual(800)
  expect(body.split('\n').every((l) => /^line \d+ x{40}$/.test(l))).toBe(true)
})

test('perspective is absent when the file is missing', async ($, on) => {
  world(on, {})
  expect(view(await $.prompt.submit({ text: 'a', origin: { kind: 'sdk' } } as never))).toBe('')
})

test('perspective is absent when config turns it off', async ($, on) => {
  world(on, { [`${F}/perspective.md`]: 'Prefers small steps.', [`${F}/config.json`]: JSON.stringify({ perspective: false }) })
  expect(view(await $.prompt.submit({ text: 'a', origin: { kind: 'sdk' } } as never))).toBe('')
})

test('session.start: a fresh learn lock skips ingest', async ($, on) => {
  const w = world(on, { [`${F}/.learn.lock`]: JSON.stringify({ startedAt: new Date(NOW - 60_000).toISOString() }) })
  on('session.start', (_$, e) => e as never)
  await $.session.start({ source: 'startup', cwd: '/repo', isInteractive: true } as never)
  await w.clock.advance(1000)
  expect([...w.files.keys()].some((k) => k.includes('/raw/') || k.endsWith('cursor.json'))).toBe(false)
  expect(w.files.has(`${F}/.learn.lock`)).toBe(true)
})

for (const [name, isInteractive, env, learns] of [
  ['interactive starts a background learn', true, {}, true],
  ['non-interactive (-p) does not', false, {}, false],
  ['an interactive child does not', true, { MORE_LIKE_YOU_CHILD: '1' }, false],
] as const) {
  test(`session.start: ${name}`, async ($, on) => {
    const w = world(on, {}, env)
    on('session.start', (_$, e) => e as never)
    await $.session.start({ source: 'startup', cwd: '/repo', isInteractive } as never)
    await w.clock.advance(1000)
    expect(w.files.has(`${F}/.learn.lock`)).toBe(learns)
  })
}

test('session.start: autoRefresh full spawns exactly one /bin/sh refresh when stale', async ($, on) => {
  const w = world(on, {
    [`${F}/config.json`]: JSON.stringify({ autoRefresh: 'full' }),
    [`${H}/.claude/usage-state.json`]: JSON.stringify({ updated_at: NOW / 1000, five_hour: { used_percentage: 5 }, seven_day: { used_percentage: 5 } }),
  })
  on('session.start', (_$, e) => e as never)
  await $.session.start({ source: 'startup', cwd: '/repo' } as never)
  await w.clock.advance(1000)
  const sh = w.runs.filter((r) => r[0] === '/bin/sh')
  expect(sh).toHaveLength(1)
  expect(sh[0].join(' ')).toContain('MORE_LIKE_YOU_CHILD=1')
})

test('session.start: MORE_LIKE_YOU_CHILD=1 never spawns', async ($, on) => {
  const w = world(on, {
    [`${F}/config.json`]: JSON.stringify({ autoRefresh: 'full' }),
    [`${H}/.claude/usage-state.json`]: JSON.stringify({ updated_at: NOW / 1000 }),
  }, { MORE_LIKE_YOU_CHILD: '1' })
  on('session.start', (_$, e) => e as never)
  await $.session.start({ source: 'startup', cwd: '/repo' } as never)
  await w.clock.advance(1000)
  expect(w.runs.filter((r) => r[0] === '/bin/sh')).toHaveLength(0)
})

test('tool ingest: a held learn lock returns a short message and writes nothing', async ($, on) => {
  const w = world(on, { [`${F}/.learn.lock`]: JSON.stringify({ startedAt: new Date(NOW - 60_000).toISOString() }) })
  on('tool.call', { tool: 'mcp__agent-more-like-you__more_like_you' }, (_$, e) => e as never)
  const r = await $.tool.call({ tool: 'mcp__agent-more-like-you__more_like_you', action: 'ingest' } as never)
  expect((r as any).result).toBe('learn already running')
  expect([...w.files.keys()].some((k) => k.includes('/raw/'))).toBe(false)
})
