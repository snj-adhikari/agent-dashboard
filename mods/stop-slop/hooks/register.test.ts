import { expect, test } from 'claude-code/testing'
import { RULES } from './rules'

test('attaches the voice rules once per session, not on every prompt', async ($, on) => {
  const seen: (readonly string[] | undefined)[] = []
  on('session.id', () => ({ value: 's1' }))
  on('prompt.submit', (_$, e) => {
    seen.push(e.context)
    return { text: e.text, context: e.context }
  })
  await $.prompt.submit({ text: 'first' })
  await $.prompt.submit({ text: 'second' })
  expect(seen[0]?.includes(RULES)).toBe(true)
  expect(seen[1]?.includes(RULES) ?? false).toBe(false)
})

test('rules avoid the tells they ban', () => {
  expect(RULES.includes('—')).toBe(false)
})
