import assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { textHash } from '../relayLog'
import { defaultSettings } from './config'
import { isoWeek, projectOf, providers, recap, weekStart, type RecapSnapshot } from './recap'

export async function run(): Promise<void> {
  assert.ok(providers.length > 0, 'recap exports providers')
  assert.strictEqual(weekStart('2026-W47').toDateString(), new Date(2026, 10, 16).toDateString(), '2026-W47 starts Mon 16 Nov')
  assert.strictEqual(weekStart('2021-W01').toDateString(), new Date(2021, 0, 4).toDateString(), '2021-W01 starts Mon 4 Jan')
  assert.deepStrictEqual([isoWeek(new Date(2026, 10, 19)), isoWeek(new Date(2021, 0, 3)), isoWeek(new Date(2024, 11, 30))], ['2026-W47', '2020-W53', '2025-W01'])
  assert.strictEqual(projectOf('/Users/x/Drive/agent-monitor-worktrees/feat-a'), 'agent-monitor')
  assert.strictEqual(projectOf('/Users/x/Drive/example-repo'), 'example-repo')

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-recap-'))
  const at = (d: number, h = 10): number => new Date(2026, 10, d, h).getTime()
  const line = (ms: number, text: string): string => JSON.stringify({ ts: Math.floor(ms / 1000), from: 'agent-cuckoo', sha256: textHash(text), main: true })
  fs.writeFileSync(path.join(dir, 'a.jsonl'), [line(at(16), '1'), line(at(17), 'please continue'), line(at(18), 'Escape'), line(at(9), '1'), 'not json'].join('\n'))
  fs.writeFileSync(path.join(dir, 'b.jsonl'), line(at(20), 'Approved'))
  fs.symlinkSync(path.join(dir, 'a.jsonl'), path.join(dir, 'link.jsonl'))
  const snaps: RecapSnapshot[] = [
    { ts: new Date(at(16)), tabs: [{ ref: 'workspace:1', cwd: '/r/example-repo', title: 't' }], agents: [{ pid: '11', cmd: 'claude --resume', cwd: '/r/example-repo' }], herdr: [] },
    { ts: new Date(at(17)), tabs: [{ ref: 'workspace:1', cwd: '/r/example-repo', title: 't' }], agents: [{ pid: '11', cmd: 'claude', cwd: '/r/example-repo' }, { pid: '12', cmd: '/opt/homebrew/bin/codex', cwd: '/r/agent-monitor-worktrees/x' }], herdr: [{ session: 's', paneId: 'w1:p1', host: 'cmux', cwd: '/r/agent-monitor', status: 'idle' }] },
  ]
  let asked: [Date, Date] | null = null
  const deps = { snapshots: async (since: Date, until: Date) => ((asked = [since, until]), snaps), relayDir: () => dir }
  const week = await recap('2026-W47', defaultSettings(), deps)
  assert.deepStrictEqual(asked!.map((d) => d.toDateString()), [new Date(2026, 10, 16).toDateString(), new Date(2026, 10, 23).toDateString()], 'queries Mon to next Mon')
  assert.deepStrictEqual(
    { ...week, topProjects: week.topProjects },
    { ok: true, week: '2026-W47', sessions: 4, approvals: 3, finishes: 0, errors: 0, byCli: [{ cli: 'claude', count: 1 }, { cli: 'codex', count: 1 }], topProjects: [{ name: 'agent-monitor', count: 2 }, { name: 'example-repo', count: 2 }], activeDays: 4 },
    'week counts from snapshots and relay log'
  )
  const all = await recap('all', defaultSettings(), deps, new Date(2026, 10, 30))
  assert.deepStrictEqual([all.approvals, all.activeDays], [4, 5], 'all-time includes earlier weeks')
  const empty = await recap('2026-W47', defaultSettings(), { snapshots: async () => Promise.reject(new Error('no mongo')), relayDir: () => path.join(dir, 'missing') })
  assert.deepStrictEqual([empty.sessions, empty.approvals, empty.activeDays, empty.byCli], [0, 0, 0, []], 'no sources gives zeros, not a throw')
  console.log('ok recap week counts')

  const hidden = await recap('2026-W47', { ...defaultSettings(), hideProjects: true }, deps)
  assert.strictEqual(hidden.topProjects, null)
  assert.ok(!JSON.stringify(hidden).includes('example-repo'), 'no project name anywhere in the response')
  console.log('ok recap hides projects')
  fs.rmSync(dir, { recursive: true, force: true })
}
