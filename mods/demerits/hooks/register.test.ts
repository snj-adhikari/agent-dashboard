import { expect, mock, test } from 'claude-code/testing'

test('a guard deny stops the chain; an allowed call passes the guard and commands hooks to the end', { options: { ledgerDir: '~/vault/Agents/points' } }, async ($, on) => {
  mock.env(on, { HOME: '/h' })
  let reached = 0
  on('tool.call', () => {
    reached++
    return { result: {}, text: 'ok' }
  })
  const denied = await $.tool.call({ tool: 'Write', file_path: '/h/vault/Agents/points/ledger.jsonl' } as never)
  expect(denied.deny).toMatch(/demerits/)
  expect(reached).toBe(0)
  const ok = await $.tool.call({ tool: 'Read', file_path: '/h/a.ts' } as never)
  expect(ok.deny).toBeUndefined()
  expect(reached).toBe(1)
})
