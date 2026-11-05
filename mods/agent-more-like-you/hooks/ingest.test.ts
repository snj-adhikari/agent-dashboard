import { renderMarkers } from './score'
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const V = '/n/more-like-you'
const H = '/h'
const SELF = 'U000SELF'
const T = `${H}/.claude/projects/p/s.jsonl`
const LATE = '2099-01-01T00:00:00Z'

function world(on: On, files: Record<string, { text: string; mtimeMs?: number }>, truncated = false, fail = false) {
  on('process.run', (_$, e) => {
    if (fail) throw new Error('boom')
    const f = files[e.argv[5]]
    const [a, b] = e.argv[6].replace('p', '').split(',').map(Number)
    const out = (f?.text ?? '').split('\n').filter((l) => /"promptSource":"typed"|"type":"assistant"|"type":"tool_result"/.test(l)).slice(a - 1, b).join('\n')
    return { value: { exitCode: f ? 0 : 2, stdout: out, stderr: '', isStdoutTruncated: truncated, isStderrTruncated: false } }
  })
  mock.env(on, { HOME: H, MORE_LIKE_YOU_VAULT: V })
  mock.clock(on, { now: Date.now() })
  const fs = new Map(Object.entries(files).map(([k, v]) => [k, { mtimeMs: Date.now(), ...v }]))
  const under = (p: string) => [...fs.keys()].filter((k) => k.startsWith(`${p}/`))
  on('fs.write', (_$, e) => {
    fs.set(e.path, { text: e.text, mtimeMs: Date.now() })
    return { value: undefined }
  })
  on('fs.read', (_$, e) => {
    const f = fs.get(e.path)
    if (!f) throw new Error('ENOENT')
    return { value: f.text }
  })
  on('fs.exists', (_$, e) => ({ value: fs.has(e.path) || under(e.path).length > 0 }))
  on('fs.list', (_$, e) => {
    const names = [...new Set(under(e.path).map((k) => k.slice(e.path.length + 1).split('/')[0]))]
    return {
      value: names.map((name) => {
        const f = fs.get(`${e.path}/${name}`)
        return { name, kind: f ? ('file' as const) : ('dir' as const), size: 0, mtimeMs: f?.mtimeMs ?? 0, isLink: false }
      }),
    }
  })
  return fs
}

const TOOL = 'mcp__agent-more-like-you__more_like_you'
const call = async ($: any, input: Record<string, unknown>): Promise<any> => (await $.tool.call({ tool: TOOL, ...input })).result
const ingest = ($: any, _f: string, _h: string, _root: string | null): Promise<string> => call($, { action: 'ingest' })
const runEval = ($: any, _f: string, file: string): Promise<string> => call($, { action: 'eval', file })
const queue = ($: any, _f: string, limit: number, file?: string): Promise<{ pid: string; text: string }[]> => call($, { action: 'queue', limit, file })
const label = ($: any, _f: string, labels: object[]) => call($, { action: 'label', labels })
const samples = ($: any, _f: string, audience: string): Promise<string[]> => call($, { action: 'samples', audience })

const jl = (rows: object[]) => rows.map((r) => JSON.stringify(r)).join('\n')
const slack = (id: string, ts: string, authorId: string, text: string, extra = {}) => ({ id, source: 'slack', ts, channel: 'C1', authorId, text, ...extra })
const user = (text: string, ts: string) =>
  JSON.stringify({ type: 'user', timestamp: ts, message: { content: text }, origin: { kind: 'human' }, promptSource: 'typed' })
const asst = (content: object[], ts: string) => JSON.stringify({ type: 'assistant', timestamp: ts, message: { content } })
const use = (name: string, input: object, ts: string) => asst([{ type: 'tool_use', name, input }], ts)
const cursorJson = (extra = {}) => JSON.stringify({ version: 1, identity: { slackId: SELF }, ...extra })
const classified = (fs: Map<string, { text: string }>) => [...fs.keys()].filter((k) => k.includes('-classified'))
const rowsOf = (fs: Map<string, { text: string }>, k = classified(fs)[0]) =>
  fs.get(k)!.text.split('\n').filter(Boolean).map((l) => JSON.parse(l))

const CASUAL = ['also looks fine to me .. will check later', 'and this one too .. need a minute', 'also not sure about that .. maybe later', 'and one more thing .. ping me']
const TYPED = CASUAL.map((c, i) => user(c, `2026-01-0${i + 1}T00:00:00Z`))
const FORMAL = [
  'Thank you for the update. The migration schedule requires review before approval.',
  'The deployment window has been confirmed. Stakeholders will receive a summary today.',
  'The audit findings are documented. Remediation steps are listed in the attached report.',
  'Capacity planning is complete. Additional nodes will be provisioned next quarter.',
]
const AGENT = FORMAL.map((f, i) => use('mcp__x__slack_send_message_draft', { channel_id: 'C9', message: f }, `2026-01-0${i + 1}T01:00:00Z`))
const BASE = { [`${V}/cursor.json`]: { text: cursorJson() }, [T]: { text: [...TYPED, ...AGENT].join('\n') } }

test('two-pass markers are written to phrasebook, keeping other sections', async ($, on) => {
  const fs = world(on, { ...BASE, [`${V}/phrasebook.md`]: { text: '## Mine\n- hi\n' } })
  await ingest($, V, H, null)
  const md = fs.get(`${V}/phrasebook.md`)!.text
  expect(md).toContain('## Mine\n- hi')
  expect(md).toMatch(/## Markers\nthreshold: [\d.]+\nhumanN: 4/)
  expect(md).toContain('feature padded-ellipsis')
})

test('phrasebook is created when missing and only the Markers section is replaced after', async ($, on) => {
  const fs = world(on, { ...BASE, [`${V}/phrasebook.md`]: { text: '## Markers\nthreshold: 0.9\n## Heard\n- yo\n' } })
  await ingest($, V, H, null)
  const md = fs.get(`${V}/phrasebook.md`)!.text
  expect(md).toContain('## Heard\n- yo')
  expect(md).not.toContain('threshold: 0.9')
})

test('phrasebook is created with a Markers section when missing', async ($, on) => {
  const fs = world(on, BASE)
  await ingest($, V, H, null)
  expect(fs.get(`${V}/phrasebook.md`)!.text.startsWith('## Markers')).toBe(true)
})

test('reply copied from an assistant message is ai', async ($, on) => {
  const said = 'the rollout finished cleanly across all three regions this morning'
  const fs = world(on, {
    ...BASE,
    [T]: { text: [...TYPED, asst([{ type: 'text', text: said }], '2026-01-05T00:00:00Z')].join('\n') },
    [`${V}/raw/2026-01-06-slack-pull.jsonl`]: { text: jl([slack('a', '2026-01-06T00:00:00Z', SELF, said)]) },
  })
  await ingest($, V, H, null)
  expect(rowsOf(fs).find((r) => r.id === 'a').label).toBe('ai')
})

test('typed line plus pasted assistant paragraph is mixed and only the typed line is a sample', async ($, on) => {
  const said = 'the rollout finished cleanly across all three regions this morning'
  const send = `also looks fine to me .. will check later\n\n${said}`
  const fs = world(on, {
    ...BASE,
    [T]: { text: [...TYPED, ...AGENT, asst([{ type: 'text', text: said }], '2026-01-05T00:00:00Z')].join('\n') },
    [`${V}/raw/2026-01-06-slack-pull.jsonl`]: { text: jl([slack('a', '2026-01-06T00:00:00Z', SELF, send, { channel: 'C1' })]) },
  })
  await ingest($, V, H, null)
  const row = rowsOf(fs).find((r) => r.id === 'a')
  expect(row.label).toBe('mixed')
  expect(row.paragraphs.map((p: { label: string }) => p.label)).toEqual(['human', 'ai'])
  expect(await samples($, V, 'slack-channel')).toEqual(['also looks fine to me .. will check later'])
})

test('notes: agent Edit paragraph is ai, a hand-written one can be human, mod folder skipped', async ($, on) => {
  const agentPara = 'summary of quarterly capacity trends and the proposed provisioning plan'
  const fs = world(on, {
    ...BASE,
    [T]: { text: [...TYPED, ...AGENT, use('Edit', { file_path: '/n/a.md', new_string: agentPara }, '2026-01-05T00:00:00Z')].join('\n') },
    [`${V}/config.json`]: { text: JSON.stringify({ notesDir: '/n' }) },
    '/n/a.md': { text: `---\ntags: x\n---\n${agentPara}\n\nalso looks fine to me .. will check later\n\n\`\`\`\ncode here is skipped now\n\`\`\`\n`, mtimeMs: Date.now() },
    [`${V}/own.md`]: { text: 'this file is inside the mod folder', mtimeMs: Date.now() },
    '/n/.hidden/h.md': { text: 'hidden folder paragraph should skip', mtimeMs: Date.now() },
  })
  await ingest($, V, H, null)
  const notes = rowsOf(fs).filter((r) => r.source === 'notes')
  expect(notes.map((r) => [r.label, r.id])).toEqual([['ai', 'notes:a.md#0'], ['human', 'notes:a.md#1']])
})

test('custom pull source with self and audience is ingested and fed to samples', async ($, on) => {
  const fs = world(on, {
    ...BASE,
    [`${V}/raw/2026-01-06-mail-pull.jsonl`]: {
      text: jl([{ id: 'm1', source: 'mail', ts: '2026-01-06T00:00:00Z', text: 'also looks fine to me .. will check later', self: true, audience: 'jira', target: 'K-1' }]),
    },
  })
  await ingest($, V, H, null)
  expect(rowsOf(fs).find((r) => r.id === 'm1')).toMatchObject({ audience: 'jira', author: 'self', label: 'human' })
  expect(await samples($, V, 'jira')).toHaveLength(1)
  expect(JSON.parse(fs.get(`${V}/cursor.json`)!.text).mail).toBe('2026-01-06T00:00:00Z')
})

test('observed rows are deduped with pull rows by id and advance observed coverage', async ($, on) => {
  const row = slack('dup', '2026-01-06T00:00:00Z', SELF, CASUAL[0])
  const fs = world(on, {
    ...BASE,
    [`${V}/raw/2026-01-06-slack-pull.jsonl`]: { text: jl([row]) },
    [`${V}/raw/2026-01-06-observed.jsonl`]: { text: jl([{ ...row, author: 'self' }, { ...slack('o2', '2026-01-07T00:00:00Z', 'U000OTHER', CASUAL[1]), author: 'other' }]) },
  })
  await ingest($, V, H, null)
  const rows = rowsOf(fs).filter((r) => r.source === 'slack')
  expect(rows.map((r) => r.id).sort()).toEqual(['dup', 'o2'])
  expect(rows.find((r) => r.id === 'o2').author).toBe('other')
  const c = JSON.parse(fs.get(`${V}/cursor.json`)!.text)
  expect(c.coverageBySource.slack).toBeUndefined()
  expect(c.observed.slack).toBe('2026-01-07T00:00:00Z')
})

test('captured prompts are folded, deduped against transcripts, pasted rows are vocabulary only', async ($, on) => {
  const fs = world(on, {
    ...BASE,
    [`${V}/raw/2026-01-06-prompts.jsonl`]: {
      text: jl([
        { id: 'p1', source: 'prompts', ts: '2026-01-06T00:00:00Z', text: 'a fresh prompt typed just now' },
        { id: 'p2', source: 'prompts', ts: '2026-01-06T00:01:00Z', text: CASUAL[0] },
        { id: 'p3', source: 'pasted', ts: '2026-01-06T00:02:00Z', text: 'pasted body words here', author: 'unknown' },
      ]),
    },
  })
  await ingest($, V, H, null)
  const rows = rowsOf(fs)
  expect(rows.find((r) => r.id === 'p1')).toMatchObject({ author: 'self', label: 'human' })
  expect(rows.find((r) => r.id === 'p2')).toBeUndefined()
  expect(rows.find((r) => r.id === 'p3')).toMatchObject({ author: 'unknown', label: 'unsure' })
})

test('long draft vs shorter send writes an edits row and rules.md folds feedback', async ($, on) => {
  const draft = 'Hi team,\n\nthe rollout finished cleanly across all three regions.\n\n- latency stayed flat\n- error rate stayed flat\n- no pages overnight'
  const send = 'the rollout finished cleanly across all three regions.\n\n- latency stayed flat'
  const fb = (n: number) => ({ ts: `2026-01-0${n}T00:00:00Z`, audience: 'jira', instruction: 'keep it shorter please', before: 'x' })
  const fs = world(on, {
    ...BASE,
    [T]: { text: [...TYPED, use('mcp__x__slack_send_message_draft', { channel_id: 'C1', message: draft }, '2026-01-05T00:00:00Z')].join('\n') },
    [`${V}/raw/2026-01-06-slack-pull.jsonl`]: { text: jl([slack('e', '2026-01-06T00:00:00Z', SELF, send)]) },
    [`${V}/raw/2026-01-06-feedback.jsonl`]: { text: jl([fb(1), fb(2)]) },
  })
  await ingest($, V, H, null)
  const edit = [...fs.keys()].filter((k) => k.endsWith('-edits.jsonl')).flatMap((k) => rowsOf(fs, k))[0]
  expect(edit).toMatchObject({ audience: 'slack-channel', before: draft, after: send })
  expect(edit.lengthRatio).toBeLessThan(1)
  expect(edit.removed.length).toBeGreaterThan(0)
  expect(fs.get(`${V}/rules.md`)!.text).toContain('- keep it shorter please (seen 2)')
})

test('queue is capped, label appends to the judged file, finalLabel overlay reaches samples', async ($, on) => {
  const ambiguous = ['The budget needs review today. Owners should confirm timing.', 'The roster needs review today. Leads should confirm cover.', 'The backlog needs review today. Owners should confirm scope.']
  const fs = world(on, {
    ...BASE,
    [`${V}/config.json`]: { text: JSON.stringify({ judgeLimit: 2 }) },
    [`${V}/raw/2026-01-06-slack-pull.jsonl`]: {
      text: jl(ambiguous.map((t, i) => slack(`q${i}`, `2026-01-06T00:0${i}:00Z`, SELF, t))),
    },
  })
  await ingest($, V, H, null)
  const all = await queue($, V, 10)
  expect(all).toHaveLength(2)
  expect(await queue($, V, 1)).toHaveLength(1)
  const before = classified(fs).map((k) => fs.get(k)!.text)
  await label($, V, [{ pid: all[0].pid, label: 'human', reason: 'casual' }])
  const judged = [...fs.keys()].filter((k) => k.endsWith('-judged.jsonl'))
  expect(judged).toHaveLength(1)
  await label($, V, [{ pid: all[1].pid, label: 'ai', reason: 'stiff' }])
  expect(fs.get(judged[0])!.text.split('\n').filter(Boolean)).toHaveLength(2)
  expect(classified(fs).map((k) => fs.get(k)!.text)).toEqual(before)
  expect(await queue($, V, 10)).toEqual([])
  expect(await samples($, V, 'slack-channel')).toContain(ambiguous[0])
})

test('runEval uses judged labels matched by normalised text', async ($, on) => {
  const human = 'Also this one looks fine to me'
  world(on, { '/e.jsonl': { text: jl([{ text: human, label: 'human' }, { text: 'Another stiff reply that reads machine written', label: 'ai' }]) } })
  const rows = await queue($, V, 5, '/e.jsonl')
  expect(rows).toHaveLength(2)
  await label($, V, [{ pid: rows[0].pid, label: 'human', reason: 'r' }])
  const out = await runEval($, V, '/e.jsonl')
  expect(out).toContain('heuristic only')
  expect(out).toContain('heuristic + judge')
  expect(out.split('heuristic + judge')[1]).toContain('precision(human) = 1.00')
})

test('existing raw files stay byte-identical, second run suffixes, cursor advances', async ($, on) => {
  const pullPath = `${V}/raw/2026-01-06-slack-pull.jsonl`
  const fs = world(on, { ...BASE, [pullPath]: { text: jl([slack('b', '2026-01-06T00:00:00Z', SELF, CASUAL[0])]) } })
  const before = fs.get(pullPath)!.text
  await ingest($, V, H, null)
  const first = JSON.parse(fs.get(`${V}/cursor.json`)!.text)
  expect(first.slack).toBe('2026-01-06T00:00:00Z')
  expect(first.identity.slackId).toBe(SELF)
  expect(first.coverageFrom).toBe('2026-01-01T00:00:00Z')
  expect(first.localFoldAt).toBeTruthy()
  const snap = fs.get(classified(fs)[0])!.text
  await ingest($, V, H, null)
  expect(classified(fs)[1]).toMatch(/-classified-2\.jsonl$/)
  expect(rowsOf(fs, classified(fs)[1]).filter((r) => r.id === 'b')).toEqual([])
  expect(fs.get(pullPath)!.text).toBe(before)
  expect(fs.get(classified(fs)[0])!.text).toBe(snap)
  expect(JSON.parse(fs.get(`${V}/cursor.json`)!.text).updatedAt >= first.updatedAt).toBe(true)
})

test('config threshold override and source switches apply', async ($, on) => {
  const fs = world(on, {
    ...BASE,
    [`${V}/config.json`]: { text: JSON.stringify({ threshold: 1.5, sources: { slack: false } }) },
    [`${V}/raw/2026-01-06-slack-pull.jsonl`]: { text: jl([slack('s', LATE, SELF, CASUAL[0])]) },
    [`${V}/raw/2026-01-06-github-pull.jsonl`]: { text: jl([{ id: 'g', source: 'github', ts: '2026-01-06T00:00:00Z', repo: 'o/r', number: 1, authorId: 'x', text: CASUAL[1] }]) },
  })
  await ingest($, V, H, null)
  const rows = rowsOf(fs)
  expect(rows.find((r) => r.id === 's')).toBeUndefined()
  expect(rows.find((r) => r.id === 'g')).toBeDefined()
  expect(rows.filter((r) => r.paragraphs.some((p: { label: string }) => p.label === 'human'))).toEqual([])
})

test('summary reports transcripts read, truncated and failed', async ($, on) => {
  world(on, BASE, true)
  expect(await ingest($, V, H, null)).toContain('transcripts: 1 read, 1 truncated, 0 failed')
})

test('transcript read pages until an empty page', async ($, on) => {
  const pages: string[] = []
  on('process.run', (_$, e) => {
    pages.push(e.argv[6])
    const out = pages.length < 3 ? `{"type":"assistant","timestamp":"2026-01-0${pages.length}T00:00:00Z","message":{"content":[{"type":"text","text":"page ${pages.length} output from the model here"}]}}` : ''
    return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  mock.env(on, { HOME: H, MORE_LIKE_YOU_VAULT: V })
  mock.clock(on, { now: Date.now() })
  on('fs.list', (_$, e) => ({ value: e.path === `${H}/.claude/projects` ? [{ name: 't.jsonl', kind: 'file', mtimeMs: 1 }] : [] }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', () => { throw new Error('none') })
  on('fs.write', () => ({ value: undefined }))
  expect(await ingest($, V, H, null)).toContain('coverageFrom 2026-01-01T00:00:00Z')
  expect(pages).toEqual(['1,2000p', '2001,4000p', '4001,6000p'])
})

test('notes false with a vault root walks nothing', async ($, on) => {
  const fs = world(on, {
    ...BASE,
    [`${V}/config.json`]: { text: JSON.stringify({ sources: { notes: false } }) },
    '/vault/a.md': { text: 'a hand written note with enough words', mtimeMs: Date.now() },
  })
  await ingest($, V, H, '/vault')
  expect(rowsOf(fs).filter((r) => r.source === 'notes')).toEqual([])
})

test('summary counts a failed grep', async ($, on) => {
  world(on, { [`${V}/cursor.json`]: { text: cursorJson() }, [T]: { text: '' } }, false, true)
  expect(await ingest($, V, H, null)).toContain('transcripts: 0 read, 0 truncated, 1 failed')
})

test('perspective.md text joins the AI index so a copied paragraph is ai', async ($, on) => {
  const para = 'the guiding view favours small reversible changes and plain direct wording'
  const fs = world(on, {
    ...BASE,
    [`${V}/perspective.md`]: { text: `# View\n\n${para}\n` },
    [`${V}/raw/2026-01-06-slack-pull.jsonl`]: { text: jl([slack('pv', '2026-01-06T00:00:00Z', SELF, para)]) },
  })
  await ingest($, V, H, null)
  expect(rowsOf(fs).find((r) => r.id === 'pv').label).toBe('ai')
})

test('runEval passes phrasebook markers: a matching row is predicted human', async ($, on) => {
  const markers = { threshold: 0.6, humanN: 3, aiN: 3, items: [{ kind: 'feature' as const, pattern: 'padded-ellipsis', weight: 0.3, h: 3, a: 0 }, { kind: 'feature' as const, pattern: 'laughter', weight: 0.3, h: 3, a: 0 }] }
  world(on, {
    '/e.jsonl': { text: jl([{ text: 'rebooted it .. all good lol', label: 'human' }, { text: 'plain words only', label: 'ai' }]) },
    [`${V}/phrasebook.md`]: { text: renderMarkers(markers) },
  })
  const out = await runEval($, V, '/e.jsonl')
  expect(out.split('heuristic + judge')[0]).toContain('actual human    1           0')
})

const SEED = { threshold: 0.7, humanN: 40, aiN: 40, items: [{ kind: 'feature' as const, pattern: 'padded-ellipsis', weight: 0.9, h: 12, a: 1 }, { kind: 'feature' as const, pattern: 'laughter', weight: 0.8, h: 10, a: 1 }] }
const promptRow = (id: string, ts: string, text: string) => ({ id, source: 'prompts', ts, text })
const seeded = (rows: object[]) => ({
  [`${V}/cursor.json`]: { text: cursorJson({ prompts: '2025-12-31T00:00:00Z' }) },
  [`${V}/phrasebook.md`]: { text: renderMarkers(SEED) },
  [`${V}/raw/2026-01-01-prompts.jsonl`]: { text: jl(rows) },
})
const markersOf = (fs: Map<string, { text: string }>) => fs.get(`${V}/phrasebook.md`)!.text

test('incremental ingest keeps markers and threshold over tiny slices', async ($, on) => {
  const rows = [promptRow('p1', '2026-01-01T00:00:00Z', 'ok .. will do lol'), promptRow('p2', '2026-01-01T00:00:01Z', 'sure .. later lol')]
  const fs = world(on, seeded(rows))
  await call($, { action: 'ingest' })
  expect(markersOf(fs)).toContain('threshold: 0.7')
  expect(markersOf(fs)).toContain('humanN: 42')
  fs.set(`${V}/raw/2026-01-02-prompts.jsonl`, { text: jl([promptRow('p3', '2026-01-02T00:00:00Z', 'fine .. thanks lol')]) })
  await call($, { action: 'ingest' })
  expect(markersOf(fs)).toContain('threshold: 0.7')
  expect(markersOf(fs)).toContain('humanN: 43')
  expect(markersOf(fs)).toContain('feature padded-ellipsis')
  expect(markersOf(fs)).toContain('feature laughter')
})

test('ingest full:true relearns markers over everything', async ($, on) => {
  const rows = [promptRow('p1', '2026-01-01T00:00:00Z', 'ok .. will do lol'), promptRow('p2', '2026-01-01T00:00:01Z', 'sure .. later lol')]
  const fs = world(on, seeded(rows))
  await call($, { action: 'ingest', full: true })
  expect(markersOf(fs)).toContain('humanN: 2')
  expect(markersOf(fs)).not.toContain('threshold: 0.7')
})

test('typed one-liners never become structure markers; bulleted slack sends do, for slack only', async ($, on) => {
  const bulleted = (n: number) => `also checked ${n} ..\n- staging fine ..\n- prod after lunch ..\n- ping me ..`
  const fs = world(on, {
    ...BASE,
    [`${V}/raw/2026-01-06-slack-pull.jsonl`]: { text: jl([1, 2, 3].map((n) => slack(`s${n}`, `2026-01-06T0${n}:00:00Z`, SELF, bulleted(n)))) },
  })
  await ingest($, V, H, null)
  expect(rowsOf(fs).filter((r) => r.source === 'slack').map((r) => r.label)).toEqual(['human', 'human', 'human'])
  const structure = fs.get(`${V}/phrasebook.md`)!.text.split('\n').filter((l) => l.startsWith('- structure '))
  expect(structure.some((l) => l.startsWith('- structure slack-channel:bullets '))).toBe(true)
  expect(structure.every((l) => l.startsWith('- structure slack-channel:'))).toBe(true)
  expect(structure.some((l) => l.includes(':single-line'))).toBe(false)
})
