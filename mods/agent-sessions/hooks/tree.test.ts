import { expect, test } from 'claude-code/testing'
import { formatSessions } from './tree'

const state = {
  repos: [
    {
      name: 'web-app',
      worktrees: [
        { path: '/w/main', isMain: true, branch: 'develop', changedFiles: 0 },
        { path: '/w/fix-a', isMain: false, branch: 'fix/a', changedFiles: 2 },
        { path: '/w/idle', isMain: false, branch: 'fix/idle', changedFiles: 0 }
      ]
    }
  ],
  tabs: [{ ref: 'workspace:1', cwd: '/w/fix-a/web', title: 'do the thing', lastActive: '5m ago', sessionId: 's1' }],
  agents: [
    { pid: '10', cmd: 'claude', cwd: '/w/fix-a/web', sessionId: 's1' },
    { pid: '11', cmd: 'claude', cwd: '/elsewhere', sessionId: 's2' }
  ]
}

test('groups sessions under their worktree, counts idle, lists strays', () => {
  const out = formatSessions(state)
  expect(out.includes('web-app  (1 active, 2 idle)')).toBe(true)
  expect(out.includes('fix/a · 2 changed')).toBe(true)
  expect(out.includes('workspace:1  do the thing  5m ago')).toBe(true)
  expect(out.includes('pid 10')).toBe(false)
  expect(out.includes('claude pid 11  (no cmux tab)  /elsewhere')).toBe(true)
})

test('says so when there are no sessions', () => {
  expect(formatSessions({ repos: [], tabs: [], agents: [] })).toBe('No Claude sessions found.')
})
