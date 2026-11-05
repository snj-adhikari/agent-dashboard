import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const STATE = '/h/.claude/agent-orchestration'

function world(on: On, env: Record<string, string>) {
  const files = new Map<string, string>()
  const runs: string[][] = []
  const fills: string[] = []
  const submitted: string[] = []
  let tree = ''
  const under = (p: string) => [...files.keys()].filter(k => k.startsWith(`${p}/`))

  mock.env(on, { HOME: '/h', ...env })
  const clock = mock.clock(on)
  on('session.cwd', () => ({ value: '/repo' }))
  on('command.list', () => ({
    value: [
      { name: 'review', description: '', source: 'plugin' },
      { name: 'loop', description: '', source: 'plugin' },
      { name: 'compact', description: '', source: 'builtin' },
    ],
  }))
  on('fs.write', (_$, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', (_$, e) => ({ value: files.get(e.path) ?? '' }))
  on('fs.exists', (_$, e) => ({ value: files.has(e.path) || under(e.path).length > 0 }))
  on('fs.list', (_$, e) => ({
    value: [...new Set(under(e.path).map(k => k.slice(e.path.length + 1).split('/')[0]))].map(name => ({
      name,
      kind: files.has(`${e.path}/${name}`) ? ('file' as const) : ('dir' as const),
    })),
  }))
  on('session.start', (_$, e) => e as never)
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return { text: e.text, context: e.context }
  })
  on('tool.register', () => ({ value: undefined }) as never)
  on('prompt.fill', (_$, e) => {
    fills.push(e.text)
    return { isFilled: true } as never
  })
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    runs.push(argv)
    let stdout = ''
    if (argv[0] === 'rm') under(argv[2]).forEach(k => files.delete(k))
    if (argv[0] === 'mv') {
      files.set(argv[2], files.get(argv[1]) ?? '')
      files.delete(argv[1])
    }
    if (argv[1] === 'identify') stdout = JSON.stringify({ caller: { pane_ref: 'pane:2' } })
    if (argv[1] === 'new-surface') stdout = 'OK surface:9'
    if (argv[1] === 'tree') stdout = tree
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  return { files, runs, fills, submitted, clock, setTree: (t: string) => (tree = t) }
}

const typed = (text: string) => {
  const m = /^\/(\S+)\s*(.*)$/.exec(text)
  return { text, wait: false, origin: { kind: 'user' }, ...(m ? { command: { name: m[1], args: m[2] } } : {}) } as never
}

const seedRun = (files: Map<string, string>, id: string) =>
  files.set(`${STATE}/runs/${id}/meta.json`, JSON.stringify({ main: 'surface:1', skill: '/review', child: 'surface:9', started: 0 }))

test('a typed skill is dropped and opened in a sub-tab', async ($, on) => {
  const w = world(on, { CMUX_SURFACE_ID: 'surface:1' })
  const result = await $.prompt.submit(typed('/review 12'))
  await w.clock.advance(500)
  expect(result.drop).toContain('surface:9')
  const opened = w.runs.find(r => r[1] === 'new-surface') ?? []
  expect(opened.join(' ')).toContain('--pane pane:2')
  expect(opened.at(-1)).toContain('AGENT_SUBTAB_ID=')
  const meta = [...w.files.entries()].find(([k]) => k.endsWith('meta.json'))?.[1] ?? ''
  expect(JSON.parse(meta)).toEqual(expect.objectContaining({ main: 'surface:1', skill: '/review', child: 'surface:9' }))
  expect(w.fills).toEqual([''])
})

test('built-ins, stay-in-main skills and plain text pass through', async ($, on) => {
  const w = world(on, { CMUX_SURFACE_ID: 'surface:1' })
  for (const text of ['/compact', '/loop 5m /review', 'hello']) {
    expect((await $.prompt.submit(typed(text))).drop).toBe(undefined)
  }
  expect(w.runs.some(r => r[1] === 'new-surface')).toBe(false)
})

test('a sub-tab gets the handoff instructions', async ($, on) => {
  world(on, { CMUX_SURFACE_ID: 'surface:9', AGENT_SUBTAB_ID: 'abc' })
  const result = await $.prompt.submit(typed('/review 12'))
  expect(result.context?.some(c => c.includes(`${STATE}/runs/abc/done`))).toBe(true)
})

test('a finished run is relayed, its tab closed and its folder removed', async ($, on) => {
  const w = world(on, { CMUX_SURFACE_ID: 'surface:1' })
  w.setTree('surface:9')
  seedRun(w.files, 'abc')
  w.files.set(`${STATE}/runs/abc/summary.md`, '/review: approved')
  w.files.set(`${STATE}/runs/abc/done`, '')
  await $.session.start({ source: 'startup', cwd: '/repo' } as never)
  await w.clock.advance(3000)
  expect(w.submitted).toContain('[subtab done]\n/review: approved')
  expect(w.runs.some(r => r.join(' ') === 'cmux close-surface --surface surface:9')).toBe(true)
  expect(w.files.has(`${STATE}/runs/abc/meta.json`)).toBe(false)
})

test('closing a sub-tab with cmux is refused while its run is live', async ($, on) => {
  const w = world(on, { CMUX_SURFACE_ID: 'surface:1' })
  w.setTree('surface:9')
  seedRun(w.files, 'abc')
  const call = await $.tool.call({ tool: 'Bash', command: 'cmux close-surface --surface surface:9' } as never)
  expect(JSON.stringify(call)).toContain('still running')
})

const classicPrompt = (permission_mode?: string) =>
  ({ hook_event_name: 'UserPromptSubmit', session_id: 's1', transcript_path: '', cwd: '/repo', prompt: 'x', permission_mode }) as never

test('a sub-tab starts in the main tab permission mode, default when unknown', async ($, on) => {
  const w = world(on, { CMUX_SURFACE_ID: 'surface:1' })
  on('classic.UserPromptSubmit', (_$, e) => e as never)
  await $.prompt.submit(typed('/review 1'))
  await w.clock.advance(500)
  expect((w.runs.find(r => r[1] === 'new-surface') ?? []).at(-1)).toContain('claude --permission-mode default "')
  await $.classic.UserPromptSubmit(classicPrompt('plan'))
  expect(JSON.parse(w.files.get(`${STATE}/mode-surface:1.json`) ?? '{}').mode).toBe('plan')
  w.runs.length = 0
  await $.prompt.submit(typed('/review 2'))
  await w.clock.advance(500)
  expect((w.runs.find(r => r[1] === 'new-surface') ?? []).at(-1)).toContain('claude --permission-mode plan "')
})

test('an unknown or injected mode never reaches the shell command', async ($, on) => {
  const w = world(on, { CMUX_SURFACE_ID: 'surface:1' })
  on('classic.UserPromptSubmit', (_$, e) => e as never)
  await $.classic.UserPromptSubmit(classicPrompt('plan; rm -rf /'))
  expect(w.files.has(`${STATE}/mode-surface:1.json`)).toBe(false)
  w.files.set(`${STATE}/mode-surface:1.json`, JSON.stringify({ mode: '$(boom)' }))
  await $.prompt.submit(typed('/review 3'))
  await w.clock.advance(500)
  expect((w.runs.find(r => r[1] === 'new-surface') ?? []).at(-1)).toContain('--permission-mode default "')
})
