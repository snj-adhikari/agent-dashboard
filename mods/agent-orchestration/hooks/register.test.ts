import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const STATE = '/h/.claude/agent-orchestration'

function world(on: On, env: Record<string, string>, failing: string[] = []) {
  const files = new Map<string, string>()
  const runs: string[][] = []
  const sessions: (string | undefined)[] = []
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
      { name: 'SNJ-work-on-new-worktree', description: '', source: 'plugin' },
      { name: 'ponytail:ponytail-review', description: '', source: 'plugin' },
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
    sessions.push(e.init?.env?.HERDR_SESSION)
    let stdout = ''
    let exitCode = 0
    if (argv[0] === 'rm') under(argv[2]).forEach(k => files.delete(k))
    if (argv[0] === 'mv') {
      files.set(argv[2], files.get(argv[1]) ?? '')
      files.delete(argv[1])
    }
    if (argv[1] === 'identify') stdout = JSON.stringify({ caller: { pane_ref: 'pane:2' } })
    if (argv[1] === 'new-surface') stdout = 'OK surface:9'
    if (argv[1] === 'tree') stdout = tree
    if (argv[0] === 'herdr' && argv[1] === 'tab' && argv[2] === 'create') {
      stdout = JSON.stringify({ result: { tab: { tab_id: 'w1:t2' }, root_pane: { pane_id: 'w1:p2' } } })
    }
    if (argv[0] === 'herdr' && argv[1] === 'pane' && argv[2] === 'list') stdout = tree
    if (argv[0] === 'hc' && argv[1] === 'get') stdout = JSON.stringify({ address: argv[2], labels: { 'herdr.space': 'sp1' } })
    if (argv[0] === 'hc' && argv[1] === 'run') stdout = JSON.stringify({ address: 't9', state: 'live' })
    if (argv[0] === 'hc' && argv[1] === 'ls') stdout = tree
    if (argv[0] === 'mem-low') [exitCode, stdout] = [1, 'RAM free 5%']
    if (argv[0] === 'namer') stdout = JSON.stringify({ codename: 'bond' })
    if (failing.includes(argv.slice(0, 3).join(' '))) [exitCode, stdout] = [1, '']
    return { value: { exitCode, stdout, stderr: failing.length ? 'boom' : '' } }
  })
  return { files, runs, sessions, fills, submitted, clock, setTree: (t: string) => (tree = t) }
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

test('AGENT_SUBTAB_MODE sets the mode when the main tab mode is unknown, and an invalid one is ignored', async ($, on) => {
  const w = world(on, { CMUX_SURFACE_ID: 'surface:1', AGENT_SUBTAB_MODE: 'auto' })
  await $.prompt.submit(typed('/review 4'))
  await w.clock.advance(500)
  expect((w.runs.find(r => r[1] === 'new-surface') ?? []).at(-1)).toContain('claude --permission-mode auto "')
  w.files.set(`${STATE}/mode-surface:1.json`, JSON.stringify({ mode: 'plan' }))
  w.runs.length = 0
  await $.prompt.submit(typed('/review 5'))
  await w.clock.advance(500)
  expect((w.runs.find(r => r[1] === 'new-surface') ?? []).at(-1)).toContain('claude --permission-mode plan "')
})

test('an invalid AGENT_SUBTAB_MODE falls back to default', async ($, on) => {
  const w = world(on, { CMUX_SURFACE_ID: 'surface:1', AGENT_SUBTAB_MODE: 'auto; rm -rf /' })
  await $.prompt.submit(typed('/review 6'))
  await w.clock.advance(500)
  expect((w.runs.find(r => r[1] === 'new-surface') ?? []).at(-1)).toContain('claude --permission-mode default "')
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

test('a sub-tab relays questions but not turns that keep running on their own', async ($, on) => {
  const w = world(on, { CMUX_SURFACE_ID: 'surface:9', AGENT_SUBTAB_ID: 'abc' })
  w.files.set(`${STATE}/runs/abc/meta.json`, JSON.stringify({ main: 'surface:1', skill: '/factory', child: 'surface:9', started: 0 }))
  on('turn.complete', () => ({ text: '' }) as never)
  const asks = () => [...w.files.keys()].filter(k => /\/ask-\d+\.json$/.test(k))
  for (const line of ['FACTORY: CONTINUE', 'FACTORY: WAIT']) {
    await $.turn.complete({ answer: `round done\n${line}`, isAborted: false } as never)
  }
  expect(asks()).toHaveLength(0)
  await $.turn.complete({ answer: 'Which branch?\nFACTORY: ASK', isAborted: false } as never)
  expect(asks()).toHaveLength(1)
})

test('the relay tells the main tab to act as the user from its mission', async ($, on) => {
  world(on, { CMUX_SURFACE_ID: 'surface:1' })
  const r = await $.prompt.submit({ text: '[subtab x asks]', wait: false, origin: { kind: 'plugin', name: 'agent-orchestration' } } as never)
  expect(r.context?.join('\n')).toContain('Act as the user')
  expect(r.context?.join('\n')).toContain('mission, goal and context the user gave you in this tab')
})

const relayedAsk = { text: '[subtab w1:p2 /fix asks]', wait: false, origin: { kind: 'plugin', name: 'agent-orchestration' } } as never

test('a sub-tab choice such as a review verdict goes to the user as a pick list, recommended first', async ($, on) => {
  world(on, { CMUX_SURFACE_ID: 'surface:1' })
  const context = (await $.prompt.submit(relayedAsk)).context?.join('\n') ?? ''
  expect(context).toContain('When the sub-tab offers choices')
  expect(context).toContain('"(Recommended)"')
})

test('commit, push and PR asks go to the user as a question, with no approval helper by default', async ($, on) => {
  world(on, { CMUX_SURFACE_ID: 'surface:1' })
  const context = (await $.prompt.submit(relayedAsk)).context?.join('\n') ?? ''
  expect(context).toContain('AskUserQuestion')
  expect(context).not.toContain('Approval helper')
})

test('a configured approval helper is run with the sub-tab session and pane before replying', async ($, on) => {
  world(on, { CMUX_SURFACE_ID: 'surface:1', AGENT_SUBTAB_APPROVER: 'approve-cmd' })
  const context = (await $.prompt.submit(relayedAsk)).context?.join('\n') ?? ''
  expect(context).toContain('run `approve-cmd <session> <pane> <kinds> [branch]`')
})

const HERDR = { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1', HERDR_WORKSPACE_ID: 'w1', HERDR_SESSION: 'grille', CMUX_SURFACE_ID: 'surface:1' }

test('the stay list skips listed skills, with a trailing * as a prefix', async ($, on) => {
  const w = world(on, { CMUX_SURFACE_ID: 'surface:1', AGENT_SUBTAB_STAY: 'SNJ-work-on-new-worktree, ponytail*' })
  for (const text of ['/SNJ-work-on-new-worktree mc-1', '/ponytail:ponytail-review']) {
    expect((await $.prompt.submit(typed(text))).drop).toBe(undefined)
  }
  expect(w.runs.some(r => r[1] === 'new-surface')).toBe(false)
  expect((await $.prompt.submit(typed('/review 1'))).drop).toContain('surface:9')
  await w.clock.advance(500)
})

test('a failing guard drops the prompt with its output and opens nothing', async ($, on) => {
  const w = world(on, { CMUX_SURFACE_ID: 'surface:1', AGENT_SUBTAB_GUARD: 'mem-low check' })
  const result = await $.prompt.submit(typed('/review 1'))
  expect(result.drop).toContain('RAM free 5%')
  expect(w.runs.some(r => r.join(' ') === 'mem-low check')).toBe(true)
  expect(w.runs.some(r => r[1] === 'new-surface')).toBe(false)
})

test('a passing guard lets the sub-tab open', async ($, on) => {
  const w = world(on, { CMUX_SURFACE_ID: 'surface:1', AGENT_SUBTAB_GUARD: 'mem-ok' })
  expect((await $.prompt.submit(typed('/review 1'))).drop).toContain('surface:9')
  await w.clock.advance(500)
})

test('inside herdr a skill opens a herdr tab keyed by the pane, not a cmux surface', async ($, on) => {
  const w = world(on, HERDR)
  const result = await $.prompt.submit(typed('/review 12'))
  await w.clock.advance(500)
  expect(result.drop).toContain('w1:p2')
  expect(w.runs.some(r => r[0] === 'cmux' && r[1] === 'new-surface')).toBe(false)
  const create = (w.runs.find(r => r[0] === 'herdr' && r[2] === 'create') ?? []).join(' ')
  expect(create).toContain('--label /review')
  expect(create).toContain('--workspace w1')
  expect(create).toMatch(/--env AGENT_SUBTAB_ID=[0-9a-f]{8}/)
  const start = w.runs.find(r => r[0] === 'herdr' && r[2] === 'start') ?? []
  expect(start).toEqual(['herdr', 'agent', 'start', start[3], '--kind', 'claude', '--pane', 'w1:p2', '--', '--permission-mode', 'default'])
  expect(w.runs.find(r => r[2] === 'prompt')).toEqual(['herdr', 'agent', 'prompt', 'w1:p2', '/review 12'])
  expect(w.runs.every((r, i) => r[0] !== 'herdr' || w.sessions[i] === 'grille')).toBe(true)
  const meta = [...w.files.entries()].find(([k]) => k.endsWith('meta.json'))?.[1] ?? ''
  expect(JSON.parse(meta)).toEqual(expect.objectContaining({ main: 'grille:w1:p1', child: 'w1:p2', tab: 'w1:t2', session: 'grille' }))
})

test('a namer gives the herdr agent and tab a codename and reports it as pane metadata', async ($, on) => {
  const w = world(on, { ...HERDR, AGENT_SUBTAB_NAMER: 'namer codename' })
  await $.prompt.submit(typed('/review 12'))
  await w.clock.advance(500)
  const namer = w.runs.find(r => r[0] === 'namer') ?? []
  expect(namer.slice(0, 4)).toEqual(['namer', 'codename', 'grille', '--seed'])
  expect((w.runs.find(r => r[2] === 'create') ?? []).join(' ')).toContain('--label /review · bond')
  expect((w.runs.find(r => r[2] === 'start') ?? [])[3]).toBe('sub-bond')
  expect(w.runs.find(r => r[2] === 'report-metadata')).toEqual([
    'herdr', 'pane', 'report-metadata', 'w1:p2', '--source', 'agent-orchestration', '--display-agent', 'bond', '--token', 'codename=bond',
  ])
})

test('inside herdr a finished run closes its herdr tab and still notifies through cmux', async ($, on) => {
  const w = world(on, HERDR)
  w.setTree('"pane_id":"w1:p2"')
  w.files.set(`${STATE}/runs/abc/meta.json`, JSON.stringify({ main: 'grille:w1:p1', skill: '/review', child: 'w1:p2', tab: 'w1:t2', session: 'grille', started: 0 }))
  w.files.set(`${STATE}/runs/abc/done`, '')
  await $.session.start({ source: 'startup', cwd: '/repo' } as never)
  await w.clock.advance(3000)
  expect(w.runs.some(r => r.join(' ') === 'herdr tab close w1:t2')).toBe(true)
  expect(w.runs.some(r => r[0] === 'cmux' && r[1] === 'notify')).toBe(true)
  expect(w.runs.some(r => r[1] === 'close-surface')).toBe(false)
})

test('closing a live sub-tab with herdr is refused', async ($, on) => {
  const w = world(on, HERDR)
  w.setTree('"pane_id":"w1:p2"')
  w.files.set(`${STATE}/runs/abc/meta.json`, JSON.stringify({ main: 'grille:w1:p1', skill: '/review', child: 'w1:p2', tab: 'w1:t2', session: 'grille', started: 0 }))
  const call = await $.tool.call({ tool: 'Bash', command: 'herdr tab close w1:t2' } as never)
  expect(JSON.stringify(call)).toContain('still running')
})

test('a herdr reply carries the [subtab] tag', async ($, on) => {
  const w = world(on, HERDR)
  await $.tool.call({ tool: 'mcp__agent-orchestration__subtab_reply', surface: 'w1:p2', text: 'yes,\nmain' } as never)
  expect(w.runs.find(r => r[2] === 'prompt')).toEqual(['herdr', 'agent', 'prompt', 'w1:p2', '[subtab w1:p2 reply] yes, main'])
})

test('a cmux reply and a finish request are tagged too', async ($, on) => {
  const w = world(on, { CMUX_SURFACE_ID: 'surface:1' })
  const call = $.tool.call({ tool: 'mcp__agent-orchestration__subtab_reply', surface: 'surface:9', finish: true } as never)
  await w.clock.advance(500)
  await call
  const sent = w.runs.find(r => r[1] === 'send') ?? []
  expect(sent.at(-1)).toMatch(/^\[subtab surface:9 reply\] Finished:/)
})

test('a show command displays the started herdr agent under the tab title', async ($, on) => {
  const w = world(on, { ...HERDR, AGENT_SUBTAB_NAMER: 'namer codename', AGENT_SUBTAB_SHOW: 'shower attach' })
  await $.prompt.submit(typed('/review 12'))
  await w.clock.advance(500)
  expect(w.runs.find(r => r[0] === 'shower')).toEqual(['shower', 'attach', 'grille', 'sub-bond', '--title', '/review · bond'])
})

test('without a show command nothing else is run after the herdr agent starts', async ($, on) => {
  const w = world(on, HERDR)
  await $.prompt.submit(typed('/review 12'))
  await w.clock.advance(500)
  expect(w.runs.some(r => r[0] === 'shower')).toBe(false)
})

test('a herdr run belongs to its own session even when another session has the same pane id', async ($, on) => {
  const w = world(on, { ...HERDR, HERDR_SESSION: 'apig' })
  on('tool.call', () => ({ result: 'ran' }) as never)
  w.setTree('')
  w.files.set(`${STATE}/runs/abc/meta.json`, JSON.stringify({ main: 'grille:w1:p1', skill: '/review', child: 'w1:p2', tab: 'w1:t2', session: 'grille', started: 0 }))
  w.files.set(`${STATE}/runs/abc/done`, '')
  await $.session.start({ source: 'startup', cwd: '/repo' } as never)
  await w.clock.advance(3000)
  expect(w.files.has(`${STATE}/runs/abc/meta.json`)).toBe(true)
  expect(w.runs.some(r => r[1] === 'tab' && r[2] === 'close')).toBe(false)
  expect(JSON.stringify(await $.tool.call({ tool: 'Bash', command: 'herdr tab close w1:t2' } as never))).not.toContain('still running')
})

test('a failing herdr pane list keeps every run alive', async ($, on) => {
  const w = world(on, HERDR, ['herdr pane list'])
  w.files.set(`${STATE}/runs/abc/meta.json`, JSON.stringify({ main: 'grille:w1:p1', skill: '/review', child: 'w1:p2', tab: 'w1:t2', session: 'grille', started: 0 }))
  await $.session.start({ source: 'startup', cwd: '/repo' } as never)
  await w.clock.advance(3000)
  expect(w.files.has(`${STATE}/runs/abc/meta.json`)).toBe(true)
  expect(w.runs.some(r => r[1] === 'tab' && r[2] === 'close')).toBe(false)
})

test('a herdr agent that fails to start closes its tab, drops the run and notifies', async ($, on) => {
  const w = world(on, HERDR, ['herdr agent start'])
  await $.prompt.submit(typed('/review 12'))
  await w.clock.advance(500)
  expect(w.runs.some(r => r.join(' ') === 'herdr tab close w1:t2')).toBe(true)
  expect(w.runs.some(r => r[0] === 'cmux' && r[1] === 'notify' && r[3] === '/review not started')).toBe(true)
  expect(w.runs.some(r => r[2] === 'prompt')).toBe(false)
  expect([...w.files.keys()].some(k => k.endsWith('meta.json'))).toBe(false)
})

const APP = { HC_TERMINAL_ID: 't3', HC_SCOPE: 'x' }
const appMeta = JSON.stringify({ main: 'hc:t3', skill: '/review', child: 't9', session: 'hc', started: 0 })

test('inside the Herdr app a skill opens an hc terminal as a tab in the caller space', async ($, on) => {
  const w = world(on, APP)
  const result = await $.prompt.submit(typed('/review 12'))
  await w.clock.advance(2000)
  expect(result.drop).toContain('t9')
  expect(w.runs.some(r => r[0] === 'cmux' || r[0] === 'herdr')).toBe(false)
  const run = w.runs.find(r => r[0] === 'hc' && r[1] === 'run') ?? []
  const id = (run.join(' ').match(/AGENT_SUBTAB_ID=([0-9a-f]{8})/) ?? [])[1]
  expect(id).toBeDefined()
  expect(run).toEqual(['hc', 'run', '--bg', '--json', '--no-parent', '--name', `sub-${id}`, '--cwd', '/repo', '--label', `agent=sub-${id}`,
    '--label', 'herdr.space=sp1', '--label', `herdr.tab=sub-${id}`, '--', 'env', `AGENT_SUBTAB_ID=${id}`, 'claude', '--permission-mode', 'default', '/review 12'])
  expect(w.runs.find(r => r[0] === 'herdr-app')).toEqual(['herdr-app', 'do', 'tab.rename', JSON.stringify({ id: `sub-${id}`, name: '/review' })])
  const meta = [...w.files.entries()].find(([k]) => k.endsWith('meta.json'))?.[1] ?? ''
  expect(JSON.parse(meta)).toEqual(expect.objectContaining({ main: 'hc:t3', child: 't9', session: 'hc' }))
})

test('inside the Herdr app a namer codename names the terminal and tab', async ($, on) => {
  const w = world(on, { ...APP, AGENT_SUBTAB_NAMER: 'namer codename' })
  await $.prompt.submit(typed('/review 12'))
  await w.clock.advance(2000)
  expect((w.runs.find(r => r[0] === 'namer') ?? []).slice(0, 4)).toEqual(['namer', 'codename', 'hc', '--seed'])
  expect((w.runs.find(r => r[1] === 'run') ?? []).slice(5, 7)).toEqual(['--name', 'sub-bond'])
  expect((w.runs.find(r => r[0] === 'herdr-app') ?? [])[3]).toContain('/review · bond')
})

test('herdr env wins over an hc terminal id', async ($, on) => {
  const w = world(on, { ...HERDR, ...APP })
  await $.prompt.submit(typed('/review 12'))
  await w.clock.advance(500)
  expect(w.runs.some(r => r[0] === 'hc')).toBe(false)
  expect(w.runs.some(r => r[0] === 'herdr' && r[2] === 'create')).toBe(true)
})

test('a Herdr app reply goes through hc send with the [subtab] tag', async ($, on) => {
  const w = world(on, APP)
  await $.tool.call({ tool: 'mcp__agent-orchestration__subtab_reply', surface: 't9', text: 'yes,\nmain' } as never)
  expect(w.runs.find(r => r[1] === 'send')).toEqual(['hc', 'send', 't9', '[subtab t9 reply] yes, main'])
})

test('a finished Herdr app run kills and removes its terminal', async ($, on) => {
  const w = world(on, APP)
  w.setTree(JSON.stringify({ terminals: [{ address: 't9' }] }))
  w.files.set(`${STATE}/runs/abc/meta.json`, appMeta)
  w.files.set(`${STATE}/runs/abc/done`, '')
  await $.session.start({ source: 'startup', cwd: '/repo' } as never)
  await w.clock.advance(3000)
  expect(w.runs.some(r => r.join(' ') === 'hc kill t9')).toBe(true)
  expect(w.runs.some(r => r.join(' ') === 'hc rm t9')).toBe(true)
  expect(w.submitted.some(t => t.startsWith('[subtab done]'))).toBe(true)
})

test('a Herdr app terminal gone from hc ls ends its run', async ($, on) => {
  const w = world(on, APP)
  w.setTree(JSON.stringify({ terminals: [{ address: 't4' }] }))
  w.files.set(`${STATE}/runs/abc/meta.json`, appMeta)
  await $.session.start({ source: 'startup', cwd: '/repo' } as never)
  await w.clock.advance(3000)
  expect(w.files.has(`${STATE}/runs/abc/meta.json`)).toBe(false)
  expect(w.submitted.some(t => t.includes('closed without a summary'))).toBe(true)
})

test('a failing hc ls keeps Herdr app runs alive', async ($, on) => {
  const w = world(on, APP, ['hc ls --json'])
  w.files.set(`${STATE}/runs/abc/meta.json`, appMeta)
  await $.session.start({ source: 'startup', cwd: '/repo' } as never)
  await w.clock.advance(3000)
  expect(w.files.has(`${STATE}/runs/abc/meta.json`)).toBe(true)
})

test('killing a live Herdr app sub-tab with hc is refused', async ($, on) => {
  const w = world(on, APP)
  w.setTree(JSON.stringify({ terminals: [{ address: 't9' }] }))
  w.files.set(`${STATE}/runs/abc/meta.json`, appMeta)
  expect(JSON.stringify(await $.tool.call({ tool: 'Bash', command: 'hc kill t9' } as never))).toContain('still running')
})

const MAIN_APP = { HC_TERMINAL_ID: 't1' }
const MAIN_FILE = `${STATE}/main/hc_sp1.json`
const peersJson = (rows: [string, string][]) =>
  JSON.stringify({ terminals: rows.map(([address, status]) => ({ address, status, where: `agent-monitor / ${address}-name` })) })
const said = (text: string) => ({ text, wait: false, origin: { kind: 'user' } }) as never

test('claiming main with nobody holding it takes the space and reports its agents', async ($, on) => {
  const w = world(on, MAIN_APP)
  w.setTree(peersJson([['t1', 'working'], ['t2', 'blocked']]))
  const r = await $.prompt.submit(said('you are the main agent here'))
  expect(JSON.parse(w.files.get(MAIN_FILE) ?? '{}').surface).toBe('t1')
  const ctx = r.context?.join('\n') ?? ''
  expect(ctx).toContain('t2-name (t2): blocked')
  expect(ctx).not.toContain('(t1)')
  expect(ctx).toContain('Validate')
})

test('claiming over a live main asks the user instead of switching', async ($, on) => {
  const w = world(on, MAIN_APP)
  w.setTree(peersJson([['t2', 'idle']]))
  w.files.set(MAIN_FILE, JSON.stringify({ surface: 't2', at: 0 }))
  const r = await $.prompt.submit(said('be main'))
  expect(r.context?.join('\n')).toContain('AskUserQuestion')
  expect(JSON.parse(w.files.get(MAIN_FILE) ?? '{}').surface).toBe('t2')
})

test('a claim held by a terminal that is gone is taken over without asking', async ($, on) => {
  const w = world(on, MAIN_APP)
  w.setTree(peersJson([['t3', 'idle']]))
  w.files.set(MAIN_FILE, JSON.stringify({ surface: 't9', at: 0 }))
  await $.prompt.submit(said('claim main'))
  expect(JSON.parse(w.files.get(MAIN_FILE) ?? '{}').surface).toBe('t1')
})

test('mentioning agents adds the report only in the main tab', async ($, on) => {
  const w = world(on, MAIN_APP)
  w.setTree(peersJson([['t2', 'idle']]))
  expect((await $.prompt.submit(said('how are the agents'))).context).toBe(undefined)
  w.files.set(MAIN_FILE, JSON.stringify({ surface: 't1', at: 0 }))
  expect((await $.prompt.submit(said('how are the agents'))).context?.join('\n')).toContain('t2-name (t2): idle')
})

test('the main tab is told when an agent blocks, finishes or closes, and the old main when it loses the claim', async ($, on) => {
  const w = world(on, MAIN_APP)
  w.files.set(MAIN_FILE, JSON.stringify({ surface: 't1', at: 0 }))
  w.setTree(peersJson([['t2', 'working'], ['t3', 'working'], ['t4', 'idle']]))
  await $.session.start({ source: 'startup', cwd: '/repo' } as never)
  await w.clock.advance(10000)
  expect(w.submitted.filter(t => t.startsWith('[agents]'))).toHaveLength(0)
  w.setTree(peersJson([['t2', 'blocked'], ['t3', 'done']]))
  await w.clock.advance(10000)
  const relay = w.submitted.find(t => t.startsWith('[agents]')) ?? ''
  expect(relay).toContain('(t2) is blocked')
  expect(relay).toContain('(t3) finished its turn')
  expect(relay).toContain('(t4) closed')
  w.files.set(MAIN_FILE, JSON.stringify({ surface: 't2', at: 1 }))
  await w.clock.advance(10000)
  expect(w.submitted.at(-1)).toContain('moved to t2')
})

test('agent_send steers a peer with a tag and refuses when this tab is not main', async ($, on) => {
  const w = world(on, MAIN_APP)
  w.setTree(peersJson([['t2', 'idle']]))
  const send = { tool: 'mcp__agent-orchestration__agent_send', target: 't2-name', text: 'run the checks' } as never
  expect(JSON.stringify(await $.tool.call(send))).toContain('claim it first')
  w.files.set(MAIN_FILE, JSON.stringify({ surface: 't1', at: 0 }))
  await $.tool.call(send)
  expect(w.runs.some(r => r.join(' ') === 'hc send t2 [main t1] run the checks')).toBe(true)
})

test('the approval helper is named in the main context when set', async ($, on) => {
  const w = world(on, { ...MAIN_APP, AGENT_SUBTAB_APPROVER: 'approve-cmd' })
  w.setTree(peersJson([]))
  const r = await $.prompt.submit(said('you are main'))
  expect(r.context?.join('\n')).toContain('run `approve-cmd <session> <terminal>')
})

test('releasing main removes this tab\'s claim', async ($, on) => {
  const w = world(on, MAIN_APP)
  w.setTree(peersJson([]))
  w.files.set(MAIN_FILE, JSON.stringify({ surface: 't1', at: 0 }))
  await $.prompt.submit(said('release main'))
  expect(w.runs.some(r => r[0] === 'rm' && r[2] === MAIN_FILE)).toBe(true)
})
