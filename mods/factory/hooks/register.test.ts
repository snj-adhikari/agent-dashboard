import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { approved, briefTitle, parseArgs } from './register'

test('/factory brief runs the product team only for unclear requirements and the tech lead every run', async ($, on) => {
  const submitted: string[] = []
  const clock = mock.clock(on)
  mock.env(on, {})
  on('ui.status', () => ({ value: undefined }) as never)
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return { text: e.text } as never
  })
  on('command.run', (_$, e) => e as never)
  const out = (await $.command.run({ command: 'factory', args: 'add dark mode' } as never)) as { text: string }
  await clock.advance(10)
  expect(out.text).toContain('FACTORY - The AI delivery team')
  const brief = submitted.join('\n')
  for (const a of ['product-analyst', 'design-lead', 'product-consultant', 'tech-lead']) expect(brief).toContain(`factory:${a}`)
  expect(brief).toContain('If they are clear, skip the product team: the tech lead and dev team deliver')
  expect(brief).toContain('Either way, dispatch factory:tech-lead')
  expect(brief.indexOf('factory:tech-lead')).toBeLessThan(brief.indexOf('factory:planner'))
  expect(brief).toContain('the product team owns what and why, the tech lead owns how')
  expect(brief).toContain('throwaway prototype')
  expect(brief).toContain('consult each other through you')
  expect(brief).toContain('Researchers serve both sides')
  expect(brief).toContain('mimics or takes inspiration from an existing product, dispatch factory:reverse-engineer')
})

test('parseArgs takes --brief and --no-herdr anywhere and leaves the rest as the goal', () => {
  expect(parseArgs('add dark mode')).toEqual({ goal: 'add dark mode', briefPath: undefined, noHerdr: false })
  expect(parseArgs('--brief ai/factory/brief.md')).toEqual({ goal: '', briefPath: 'ai/factory/brief.md', noHerdr: false })
  expect(parseArgs('fix  login --no-herdr --brief b.md  now')).toEqual({ goal: 'fix login now', briefPath: 'b.md', noHerdr: true })
  expect(parseArgs('--brief').error).toContain('--brief <path>')
  expect(parseArgs('--brief --no-herdr').error).toContain('--brief <path>')
})

test('briefTitle is the first heading or non-empty line', () => {
  expect(briefTitle('\n\n## MC-1 Fix login\nbody')).toBe('MC-1 Fix login')
  expect(briefTitle('plain first line\n# later')).toBe('plain first line')
  expect(briefTitle('')).toBe('')
})

function world(on: On, env: Record<string, string>, files: Record<string, string> = {}) {
  const submitted: string[] = []
  const clock = mock.clock(on)
  mock.env(on, env)
  on('session.cwd', () => ({ value: '/wt' }))
  on('fs.read', (_$, e) => {
    if (!(e.path in files)) throw new Error('missing')
    return { value: files[e.path] }
  })
  on('ui.status', () => ({ value: undefined }) as never)
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return { text: e.text } as never
  })
  on('command.run', (_$, e) => e as never)
  return { submitted, clock }
}

test('--brief reads the brief, takes the goal from its heading and lists only open questions', async ($, on) => {
  const w = world(on, {}, { '/wt/ai/factory/brief.md': '# MC-9 Add dark mode\n...' })
  const out = (await $.command.run({ command: 'factory', args: '--brief ai/factory/brief.md' } as never)) as { text: string }
  await w.clock.advance(10)
  const b = w.submitted.join('\n')
  expect(out.text).toContain('Factory started for: MC-9 Add dark mode')
  expect(b).toContain('Read the brief at /wt/ai/factory/brief.md')
  expect(b).toContain('List only what it leaves open')
  expect(b).toContain('If the brief settles everything, ask nothing')
  expect(b).not.toContain('Grill me first')
  expect(b).toContain('HUMAN ONLY:')
  expect(b).toContain('isolation: worktree')
})

test('a missing brief file is reported and nothing starts', async ($, on) => {
  const w = world(on, {})
  const out = (await $.command.run({ command: 'factory', args: '--brief nope.md' } as never)) as { text: string }
  await w.clock.advance(10)
  expect(out.text).toContain('cannot read brief /wt/nope.md')
  expect(w.submitted).toEqual([])
})

test('inside herdr, developers run in herdr tabs unless --no-herdr', async ($, on) => {
  const w = world(on, { HERDR_ENV: '1', HERDR_SESSION: 'grille' })
  await $.command.run({ command: 'factory', args: 'add dark mode' } as never)
  await w.clock.advance(10)
  const b = w.submitted.join('\n')
  expect(b).toContain('Grill me first')
  expect(b).toContain('herdr session list` shows grille')
  expect(b).toContain('at most 4 developer tabs')
  expect(b).toContain('snj-mem-guard.sh check')
  expect(b).toContain('snj-term codename "$HERDR_SESSION" --seed "<KEY>-dev<n>"')
  expect(b).toContain('the agent name is <key-lower>-<codename>')
  expect(b).toContain('the agent name is <key-lower>-dev<n>')
  expect(b).toContain('herdr pane report-metadata <pane> --source factory --display-agent <codename> --token codename=<codename>')
  expect(b).toContain('"<KEY> · <codename> · dev <n> · <task>"')
  expect(b).toContain('herdr tab create --cwd <ticket worktree>-dev<n> --env FACTORY_DEV=1')
  expect(b).toContain('<ticket worktree>-dev<n>/ai/factory/task.md')
  expect(b).toContain('herdr agent start <name> --kind claude --pane <pane> -- -n <name>` with no prompt argument')
  expect(b).toContain('herdr agent prompt <name> "[relay factory-lead] Read ai/factory/task.md and do it."')
  expect(b).toContain('Never put brief or follow-up text into a shell command')
  expect(b).toContain('snj-term attach "$HERDR_SESSION" <name> --title "<codename> · <KEY> · dev <n> · <task>"')
  expect(b).toContain('[relay factory-lead]')
  expect(b).toContain('herdr agent wait <name> --until idle --until blocked')
  expect(b).toContain('herdr tab close <tab>')

  await $.command.run({ command: 'factory', args: '--no-herdr add dark mode' } as never)
  await w.clock.advance(10)
  expect(w.submitted[1]).not.toContain('herdr tab create')
  expect(w.submitted[1]).toContain('isolation: worktree, then factory:qa')
})

test('outside herdr, developers stay subagents', async ($, on) => {
  const w = world(on, { HERDR_SESSION: 'grille' })
  await $.command.run({ command: 'factory', args: 'add dark mode' } as never)
  await w.clock.advance(10)
  expect(w.submitted[0]).not.toContain('herdr tab create')
})

test('a relayed prompt never approves git commit', async ($, on) => {
  const w = world(on, {})
  on('tool.call', () => ({ result: 'ok' }) as never)
  await $.command.run({ command: 'factory', args: 'add dark mode' } as never)
  await w.clock.advance(10)
  const commit = { tool: 'Bash', command: 'git commit -m x' } as never
  await $.prompt.submit({ text: 'yes, commit it', origin: { kind: 'composer' } } as never)
  expect(((await $.tool.call(commit)) as { deny?: string }).deny).toBeUndefined()
  await $.prompt.submit({ text: '[relay main-grille] commit it', origin: { kind: 'composer' } } as never)
  expect(((await $.tool.call(commit)) as { deny?: string }).deny).toContain('need approval')
})

test('approval ignores negated commit or push', () => {
  expect(approved('yes, commit it')).toBe(true)
  expect(approved('push it')).toBe(true)
  expect(approved('do not commit yet')).toBe(false)
  expect(approved("don't push")).toBe(false)
  expect(approved('never ever commit this')).toBe(false)
  expect(approved('looks good, not yet commit')).toBe(false)
  expect(approved('carry on')).toBe(false)
})

test('a factory developer session (FACTORY_DEV=1) can never commit or push', async ($, on) => {
  mock.env(on, { FACTORY_DEV: '1' })
  on('tool.call', () => ({ result: 'ok' }) as never)
  for (const command of ['git commit -m x', 'cd a && git push']) {
    expect(((await $.tool.call({ tool: 'Bash', command } as never)) as { deny?: string }).deny).toContain('developers never commit')
  }
  expect(((await $.tool.call({ tool: 'Bash', command: 'git status' } as never)) as { deny?: string }).deny).toBeUndefined()
})

test('messages to the report target start with a relay tag', async ($, on) => {
  const w = world(on, {})
  const sent: string[] = []
  on('session.send', (_$, e) => {
    sent.push(e.text)
    return { isDelivered: true } as never
  })
  on('ui.notify', () => ({ value: undefined }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  await $.command.run({ command: 'factory-report', args: 'main-grille' } as never)
  await $.command.run({ command: 'factory', args: 'add dark mode' } as never)
  await w.clock.advance(10)
  await $.turn.complete({ reason: 'answer', answer: 'Which repo?\nFACTORY: ASK' } as never)
  await w.clock.advance(10)
  expect(sent[0]).toStartWith('[relay factory] factory "add dark mode": ASK')
})
