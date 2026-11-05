import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { foldGlossary, glossaryPhrases, isCorrection, learnStep, normalisePhrase, parseFix, understoodAs, type Learnt } from './glossary'

const F = '/h/.claude/more-like-you'
const NOW = Date.now()
const DAY = '2026-11-05'
const TODAY = new Date(NOW).toISOString().slice(0, 10)
const LOCKED = JSON.stringify({ startedAt: new Date(NOW - 10 * 60_000).toISOString() })

const TABLE = `# Nepali glossary

| Phrase | Meaning |
| --- | --- |
| sample one | meaning one |
| sample two | meaning two |

Hand-written note.
`
const GLOSSARY = `${TABLE}
## Learnt

- old phrase — old meaning — 2026-10-01 — typed

## Heard from others

- heard phrase — heard meaning — 2026-10-02 — slack

## Notes

Trailing hand-written text.
`

const row = (phrase: string, meaning = 'a meaning', section: Learnt['section'] = 'learnt'): Learnt => ({ phrase, meaning, date: DAY, source: 'typed', section })

test('fold appends under Learnt', () => {
  const out = foldGlossary(GLOSSARY, [row('new phrase', 'new meaning')])!
  expect(out).toContain('- old phrase — old meaning — 2026-10-01 — typed\n- new phrase — new meaning — 2026-11-05 — typed\n\n## Heard from others')
})

test('fold creates Learnt at end if missing', () => {
  const out = foldGlossary(TABLE, [row('new phrase')])!
  expect(out.startsWith(TABLE.trimEnd())).toBe(true)
  expect(out.trimEnd().endsWith('## Learnt\n\n- new phrase — a meaning — 2026-11-05 — typed')).toBe(true)
})

test('fold appends to end of Heard from others', () => {
  const out = foldGlossary(GLOSSARY, [row('other phrase', 'other meaning', 'heard')])!
  expect(out).toContain('- heard phrase — heard meaning — 2026-10-02 — slack\n- other phrase — other meaning — 2026-11-05 — typed\n\n## Notes')
})

test('hand-written tables unchanged', () => {
  const out = foldGlossary(GLOSSARY, [row('a b'), row('c d', 'x', 'heard')])!
  expect(out.startsWith(TABLE)).toBe(true)
  expect(out.endsWith('## Notes\n\nTrailing hand-written text.\n')).toBe(true)
  expect(foldGlossary(TABLE, [row('a b')])!.startsWith(TABLE.trimEnd())).toBe(true)
  expect(foldGlossary(GLOSSARY, [])).toBe(GLOSSARY)
})

test('dedupe on normalised phrase', () => {
  const out = foldGlossary(GLOSSARY, [row('Old  Phrase!'), row('Sample One'), row('fresh one'), row('FRESH, one')])!
  expect(out.match(/fresh one/gi)).toHaveLength(1)
  expect(out.match(/old phrase/gi)).toHaveLength(1)
  expect(out.match(/sample one/gi)).toHaveLength(1)
  expect(normalisePhrase('  Hello,   World! ')).toBe('hello world')
  expect(glossaryPhrases(GLOSSARY)).toEqual(['sample one', 'sample two', 'old phrase', 'heard phrase'])
  expect(glossaryPhrases(null)).toEqual([])
})

test('line has phrase meaning date source', () => {
  const out = foldGlossary(TABLE, [{ phrase: 'p q', meaning: 'm n', date: '2026-11-05', source: 'slack', section: 'learnt' }])!
  expect(out).toContain('- p q — m n — 2026-11-05 — slack')
})

test('duplicate headings -> skipped untouched', () => {
  expect(foldGlossary(`${GLOSSARY}\n## Learnt\n`, [row('zzz')])).toBeNull()
  expect(foldGlossary(`${GLOSSARY}\n## Heard from others\n`, [row('zzz')])).toBeNull()
})

test('rows without a meaning are never folded', () => {
  expect(foldGlossary(GLOSSARY, [row('no meaning', ''), row('blank meaning', '   ')])).toBe(GLOSSARY)
})

const NEP = { kind: 'prompt' as const, nepali: true }
const ans = (m: string) => ({ kind: 'answer' as const, text: `Understood as: ${m}\nDone.` })

test('next prompt not correction -> pending learnt', () => {
  const a = learnStep(null, { ...NEP, text: 'some phrase' }, DAY)
  expect(a).toEqual({ pending: { phrase: 'some phrase' }, learn: [] })
  const b = learnStep(a.pending, ans('the meaning'), DAY)
  expect(b.pending).toEqual({ phrase: 'some phrase', meaning: 'the meaning' })
  const c = learnStep(b.pending, { kind: 'prompt', text: 'run the tests', nepali: false }, DAY)
  expect(c.learn).toEqual([{ phrase: 'some phrase', meaning: 'the meaning', date: DAY, source: 'typed', section: 'learnt' }])
  expect(c.pending).toBeNull()
})

test('correction -> corrected meaning learnt and logged', () => {
  const pending = { phrase: 'some phrase', meaning: 'wrong meaning' }
  const a = learnStep(pending, { kind: 'prompt', text: 'no, i meant the other thing', nepali: false }, DAY)
  expect(a).toEqual({ pending: { ...pending, correcting: true }, learn: [] })
  const b = learnStep(a.pending, ans('right meaning'), DAY)
  expect(b.learn).toEqual([{ phrase: 'some phrase', meaning: 'right meaning', date: DAY, source: 'typed', section: 'learnt' }])
  expect(b.correction).toEqual({ phrase: 'some phrase', from: 'wrong meaning', to: 'right meaning' })
  expect(b.pending).toBeNull()
})

test('pending without a meaning is never learnt', () => {
  const a = learnStep({ phrase: 'orphan' }, { kind: 'prompt', text: 'next one', nepali: true }, DAY)
  expect(a).toEqual({ pending: { phrase: 'next one' }, learn: [] })
  expect(learnStep({ phrase: 'x' }, { kind: 'answer', text: 'no marker here' }, DAY).pending).toEqual({ phrase: 'x' })
})

test('isCorrection markers', () => {
  for (const t of ['no that is wrong', 'Nope', 'hoina', 'i meant the file', 'matlab alag', 'not that one', 'galat']) expect(isCorrection(t)).toBe(true)
  for (const t of ['run the tests', 'now fix it', 'another thing']) expect(isCorrection(t)).toBe(false)
  expect(understoodAs('intro\nUnderstood as: do the thing\nrest')).toBe('do the thing')
  expect(understoodAs('nothing')).toBeNull()
})

test('parseFix', () => {
  expect(parseFix('fix some phrase = its meaning')).toEqual({ phrase: 'some phrase', meaning: 'its meaning' })
  expect(parseFix('some phrase=its meaning')).toEqual({ phrase: 'some phrase', meaning: 'its meaning' })
  expect(parseFix('fix only phrase')).toBeNull()
  expect(parseFix('fix  = meaning')).toBeNull()
})

test('suffixed headings match by prefix, no duplicate section', () => {
  const md = '## My phrases (my voice, with meaning)\n\n- a b — c\n\n## Heard from others (reference only, never my voice)\n\n- x y — z\n\n## Learnt (auto)\n\n- l m — n\n'
  const out = foldGlossary(md, [row('h h', 'm', 'heard'), row('l l', 'm')])!
  expect(out.match(/^## Heard/gim)).toHaveLength(1)
  expect(out.match(/^## Learnt/gim)).toHaveLength(1)
  expect(out).toContain('- x y — z\n- h h — m — 2026-11-05 — typed\n')
  expect(out).toContain('- l m — n\n- l l — m — 2026-11-05 — typed\n')
})

test('quoted bullets and table variants are known phrases', () => {
  const md = '- greetings: "kasto cha", "k xa"\n- plain — meaning\n\n| Phrase | Meaning |\n| --- | --- |\n| one / two, three | m |\n'
  expect(glossaryPhrases(md)).toEqual(['kasto cha', 'k xa', 'plain', 'one', 'two', 'three'])
  const out = foldGlossary(md, [row('K Xa'), row('Three'), row('brand new')])!
  expect(out.match(/k xa/gi)).toHaveLength(1)
  expect(out.match(/three/gi)).toHaveLength(1)
  expect(out).toContain('brand new')
})

function world(on: On, files: Record<string, string>) {
  const w = { files: new Map(Object.entries(files)), writes: [] as string[] }
  mock.env(on, { HOME: '/h' })
  mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 's1' }))
  on('session.start', (_$, e) => e as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('http.fetch', () => ({ value: { ok: false, status: 503, headers: {}, text: '' } }) as never)
  on('fs.exists', (_$, e) => ({ value: w.files.has(e.path) || [...w.files.keys()].some((k) => k.startsWith(`${e.path}/`)) }))
  on('fs.read', (_$, e) => ({ value: w.files.get(e.path) ?? '' }))
  on('fs.write', (_$, e) => (w.writes.push(e.path), w.files.set(e.path, e.text), { value: undefined }))
  on('fs.list', (_$, e) =>
    ({ value: [...w.files.keys()].filter((k) => k.startsWith(`${e.path}/`)).map((k) => ({ name: k.slice(e.path.length + 1), kind: 'file' as const })) }) as never)
  return w
}

const fix = ($: any, args: string) => $.command.run({ command: 'ne', args })
const GL = `${F}/nepali-glossary.md`
const STAGED = `${F}/raw/${TODAY}-nepali-learnt.jsonl`

test('fix stages then folds, releasing the lock; blank meaning is not staged', async ($, on) => {
  const w = world(on, { [GL]: GLOSSARY })
  await fix($, 'fix new phrase = new meaning')
  expect(await fix($, 'fix empty =')).toEqual({ text: 'Usage: /ne fix <phrase> = <meaning>' })
  expect(w.files.get(STAGED)!.trim().split('\n')).toHaveLength(1)
  expect(w.files.get(GL)).toContain('- new phrase — new meaning — 2026-11-05 — fix')
  expect(w.files.get(`${F}/.nepali-learn.lock`)).toBe('{}')
  await fix($, 'fix second phrase = second meaning')
  const md = w.files.get(GL)!
  expect(md.match(/new phrase/g)).toHaveLength(1)
  expect(md).toContain('second phrase')
  expect(md.startsWith(TABLE)).toBe(true)
})

test('session.start folds previously staged rows', async ($, on) => {
  const staged = JSON.stringify(row('old staged', 'was staged')) + '\n'
  const w = world(on, { [GL]: GLOSSARY, [STAGED]: staged })
  await $.session.start({ cwd: '/w' } as never)
  expect(w.files.get(GL)).toContain('- old staged — was staged')
})

test('locked -> glossary untouched', async ($, on) => {
  const w = world(on, { [GL]: GLOSSARY, [`${F}/.nepali-learn.lock`]: LOCKED })
  await fix($, 'fix new phrase = m')
  expect(w.files.get(GL)).toBe(GLOSSARY)
  expect(w.writes).toEqual([STAGED])
})

test('stale lock is taken over; duplicate headings leave the file untouched', async ($, on) => {
  const dup = `${GLOSSARY}\n## Learnt\n`
  const w = world(on, { [GL]: dup, [`${F}/.nepali-learn.lock`]: JSON.stringify({ startedAt: new Date(NOW - 3 * 3_600_000).toISOString() }) })
  await fix($, 'fix new phrase = m')
  expect(w.files.get(GL)).toBe(dup)
  expect(w.files.get(`${F}/.nepali-learn.lock`)).toBe('{}')
})

test('missing glossary -> rows still staged', async ($, on) => {
  const w = world(on, {})
  await fix($, 'fix new phrase = m')
  expect(w.files.has(STAGED)).toBe(true)
  expect(w.files.has(GL)).toBe(false)
})
