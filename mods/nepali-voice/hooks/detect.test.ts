import { expect, test } from 'claude-code/testing'
import { detectNepali, translateContext } from './detect'

test('devanagari detected', () => {
  expect(detectNepali('यो फाइल ठीक गर')).toBe('devanagari')
})

test('roman two hits incl unambiguous detected', () => {
  expect(detectNepali('mero test fail bhayo')).toBe('roman')
  expect(detectNepali('yo bug kina cha')).toBe('roman')
})

test('single token not detected', () => {
  expect(detectNepali('tapai')).toBe(null)
  expect(detectNepali('ho')).toBe(null)
  expect(detectNepali('ho ho ho')).toBe(null)
  expect(detectNepali('cha cha cha')).toBe(null)
  expect(detectNepali('ma ra yo')).toBe(null)
})

test('spelling variants x/ch v/bh match', () => {
  expect(detectNepali('mero build fail vayo')).toBe('roman')
  expect(detectNepali('yo kina xaina')).toBe('roman')
  expect(detectNepali('yo kina chhaina')).toBe('roman')
})

test('glossary phrase counts as hit', () => {
  expect(detectNepali('ma jhyau')).toBe(null)
  expect(detectNepali('ma jhyau', ['jhyau'])).toBe('roman')
  expect(detectNepali('ghar jaam please', ['ghar jaam'])).toBe(null)
  expect(detectNepali('ma ra', ['ra'])).toBe(null)
})

test('false positives: english, names, jargon, stack trace, code fence, url, path, identifier', () => {
  const corpus = [
    'Please fix the failing test in the login flow and then rebase onto main',
    'Ask Mara and Tom Kumar to review the migration plan',
    'Run npm run build, then check the webpack bundle and kubectl logs for the pod',
    'TypeError: Cannot read properties of undefined\n    at Object.run (/app/src/mero.js:10:5)\n    at tapai (/app/x.js:1:1)',
    'Use this:\n```\nmero tapai kina bhayo\n```\nthanks',
    'See https://example.com/mero/tapai/kina/bhayo for details',
    'Edit ~/mero/tapai/kina.ts and src/bhayo/cha.ts',
    'rename mero_tapai and kinaBhayo and chaina.config to something sensible',
    'Tara and Hera went to the shop',
    'What is the aja version and the kati count',
    'Kasari works for Tara',
  ]
  for (const c of corpus) expect(detectNepali(c)).toBe(null)
})

test('context carries Understood as + English reply + verbatim identifiers', () => {
  const c = translateContext('## Learnt\njhyau — boring — 2026-01-01 — observe')
  expect(c).toContain('Understood as:')
  expect(c).toContain('Reply in English')
  expect(c).toContain('verbatim')
  expect(c).toContain('jhyau')
  expect(c).toContain('Spelling style')
})

test('context without glossary still valid', () => {
  const c = translateContext(null)
  expect(c).toContain('Understood as:')
  expect(c).not.toContain('Glossary')
})
