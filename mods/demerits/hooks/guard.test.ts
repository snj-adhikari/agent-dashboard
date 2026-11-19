import { expect, mock, test } from 'claude-code/testing'

const LEDGER = '/h/vault/Agents/points'
const OPTIONS = { ledgerDir: '~/vault/Agents/points' }

test('Write and Edit are denied on the ledger and allowed elsewhere', { options: OPTIONS }, async ($, on) => {
  mock.env(on, { HOME: '/h' })
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  for (const tool of ['Write', 'Edit', 'MultiEdit']) {
    const r = await $.tool.call({ tool, file_path: `${LEDGER}/ledger.jsonl` } as never)
    expect(r.deny).toMatch(/demerits/)
  }
  const tilde = await $.tool.call({ tool: 'Write', file_path: '~/.claude/demerits-state/x.json' } as never)
  expect(tilde.deny).toMatch(/demerits/)
  const dots = await $.tool.call({ tool: 'Edit', file_path: `${LEDGER}/../points/ledger.jsonl` } as never)
  expect(dots.deny).toMatch(/demerits/)
  const nb = await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/h/.cache/factory/n.ipynb' } as never)
  expect(nb.deny).toMatch(/demerits/)
  const ok = await $.tool.call({ tool: 'Write', file_path: '/h/code/a.ts' } as never)
  expect(ok.deny).toBeUndefined()
  const sibling = await $.tool.call({ tool: 'Write', file_path: `${LEDGER}-other/a.md` } as never)
  expect(sibling.deny).toBeUndefined()
})

test('MCP write tools are denied on absolute and vault-relative args', { options: OPTIONS }, async ($, on) => {
  mock.env(on, { HOME: '/h' })
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  const abs = await $.tool.call({ tool: 'mcp__vault__write_file', path: `${LEDGER}/ledger.jsonl`, content: 'x' } as never)
  expect(abs.deny).toMatch(/demerits/)
  const rel = await $.tool.call({ tool: 'mcp__vault__edit_file', path: 'Agents/points/ledger.jsonl' } as never)
  expect(rel.deny).toMatch(/demerits/)
  const nested = await $.tool.call({ tool: 'mcp__vault__move_file', source: 'a.md', destination: './Agents/points/a.md' } as never)
  expect(nested.deny).toMatch(/demerits/)
  const elsewhere = await $.tool.call({ tool: 'mcp__vault__write_file', path: 'Daily/today.md' } as never)
  expect(elsewhere.deny).toBeUndefined()
  const read = await $.tool.call({ tool: 'mcp__vault__read_file', path: 'Agents/points/ledger.jsonl' } as never)
  expect(read.deny).toBeUndefined()
})

test('Bash writes to the ledger are denied, reads allowed', { options: OPTIONS }, async ($, on) => {
  mock.env(on, { HOME: '/h' })
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  const denied = [
    `echo x >> ${LEDGER}/ledger.jsonl`,
    `echo x > ~/vault/Agents/points/ledger.jsonl`,
    `echo x | tee ${LEDGER}/ledger.jsonl`,
    `mv /tmp/a ${LEDGER}/ledger.jsonl`,
    `cp /tmp/a $HOME/.claude/demerits-state/a`,
    `rm ${LEDGER}/ledger.jsonl`,
    `sed -i 's/a/b/' ${LEDGER}/ledger.jsonl`,
    `truncate -s 0 ${LEDGER}/ledger.jsonl`,
    `ls && echo x >> ~/.cache/factory/x`,
  ]
  for (const command of denied) {
    const r = await $.tool.call({ tool: 'Bash', command } as never)
    expect(r.deny ?? '').toMatch(/demerits/)
  }
  for (const command of [`cat ${LEDGER}/ledger.jsonl`, `grep x ${LEDGER}/ledger.jsonl`, `cp ${LEDGER}/ledger.jsonl /tmp/b`, 'echo x >> /tmp/a', 'ls 2>/dev/null']) {
    const r = await $.tool.call({ tool: 'Bash', command } as never)
    expect(r.deny).toBeUndefined()
  }
})

test('a guard error denies', { options: OPTIONS }, async ($, on) => {
  on('env.get', () => {
    throw new Error('boom')
  })
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  const r = await $.tool.call({ tool: 'Write', file_path: '/h/code/a.ts' } as never)
  expect(r.deny).toMatch(/guard failed/)
})
