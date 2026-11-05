import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const H = '/h'
const F = `${H}/.claude/more-like-you`
const NOW = Date.parse('2026-11-05T10:00:00Z')

function world(on: On, registered: string[] = []) {
  const w = { files: new Map<string, string>() }
  mock.env(on, { HOME: H })
  mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 's1' }))
  on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
  on('session.start', (_$, e) => e as never)
  on('fs.exists', (_$, e) => ({ value: w.files.has(e.path) || [...w.files.keys()].some((k) => k.startsWith(`${e.path}/`)) }))
  on('fs.read', (_$, e) => ({ value: w.files.get(e.path) ?? '' }))
  on('fs.list', (_$, e) => ({ value: [...w.files.keys()].filter((k) => k.startsWith(`${e.path}/`)).map((k) => ({ name: k.slice(e.path.length + 1), isDirectory: false })) }) as never)
  on('process.run', (_$, e) => ({ value: { code: 0, stdout: '', stderr: '' } }) as never)
  on('fs.write', (_$, e) => (w.files.set(e.path, e.text), { value: undefined }))
  on('http.fetch', () => ({ value: { ok: false, status: 503, headers: {}, text: '' } }) as never)
  on('command.register', (_$, e) => (registered.push(e.name), { value: undefined }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))
  return w
}

const composer = (text: string) => ({ text, origin: { kind: 'composer' } }) as never
const plugin = (text: string, name: string) => ({ text, origin: { kind: 'plugin', name } }) as never
const DEV = 'यो के हो'
const learnt = (w: { files: Map<string, string> }) => w.files.get(`${F}/raw/2026-11-05-nepali-learnt.jsonl`)

test('ne command registered', async ($, on) => {
  const seen: string[] = []
  world(on, seen)
  await $.session.start({ cwd: '/w' } as never)
  expect(seen).toContain('ne')
})

test('composer Nepali prompt gets context, text unchanged', async ($, on) => {
  world(on)
  const r = await $.prompt.submit(composer(DEV))
  expect(r.text).toBe(DEV)
  expect(r.context?.join('\n')).toContain('Understood as')
})

test('composer Roman Nepali prompt gets context', async ($, on) => {
  world(on)
  expect((await $.prompt.submit(composer('mero test fail bhayo'))).context?.join('\n')).toContain('Understood as')
})

test('English prompt untouched', async ($, on) => {
  world(on)
  const r = await $.prompt.submit(composer('please fix the failing build'))
  expect(r.context ?? []).toEqual([])
})

test('slash command skipped', async ($, on) => {
  world(on)
  expect((await $.prompt.submit(composer(`/ne ${DEV}`))).context ?? []).toEqual([])
})

test('own plugin submit gets context', async ($, on) => {
  world(on)
  expect((await $.prompt.submit(plugin(DEV, 'nepali-voice'))).context?.length).toBe(1)
})

test('other plugin submit skipped', async ($, on) => {
  world(on)
  expect((await $.prompt.submit(plugin(DEV, 'other'))).context ?? []).toEqual([])
})

test('turn.complete then non-correction prompt stages learnt row', async ($, on) => {
  const w = world(on)
  await $.prompt.submit(composer(DEV))
  await $.turn.complete({ answer: 'Understood as: what is this', reason: 'answer' } as never)
  await $.prompt.submit(composer('please continue'))
  expect(learnt(w)).toContain('what is this')
})

test('subagent turn ignored', async ($, on) => {
  const w = world(on)
  await $.prompt.submit(composer(DEV))
  await $.turn.complete({ answer: 'Understood as: what is this', agentId: 'a1', reason: 'answer' } as never)
  await $.prompt.submit(composer('please continue'))
  expect(learnt(w)).toBeUndefined()
})

test('/ne fix stages row', async ($, on) => {
  const w = world(on)
  const r = (await $.command.run({ command: 'ne', args: 'fix kasto = how are things' } as never)) as { text: string }
  expect(r.text).toContain('kasto')
  expect(learnt(w)).toContain('how are things')
})

test('missing vault files -> no crash', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/w' } as never)
  expect((await $.prompt.submit(composer('ma ghar jaanchu'))).text).toBe('ma ghar jaanchu')
})

const NE = `${F}/languages/ne-roman.json`

test('session.start writes detector when missing', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/w' } as never)
  const d = JSON.parse(w.files.get(NE) ?? '{}')
  expect(d.id).toBe('ne-roman')
  expect(d.detect.sure).toContain('chha')
})

test('session.start never overwrites existing detector', async ($, on) => {
  const w = world(on)
  w.files.set(NE, '{"id":"ne-roman","custom":true}')
  await $.session.start({ cwd: '/w' } as never)
  expect(w.files.get(NE)).toBe('{"id":"ne-roman","custom":true}')
})
