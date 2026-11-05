import { expect, test } from 'claude-code/testing'
import { lockHeld, refreshCommand, shouldSpawn } from './learn'

const NOW = Date.parse('2026-11-05T12:00:00Z')
const MIN = 60_000
const DAY = 86_400_000
const ago = (ms: number) => new Date(NOW - ms).toISOString()

const fresh = { slack: ago(DAY), jira: ago(DAY), confluence: ago(DAY), github: ago(DAY) }
const old = { slack: ago(30 * DAY), jira: ago(30 * DAY), confluence: ago(30 * DAY), github: ago(30 * DAY) }
const usage = { updated_at: (NOW - 10 * MIN) / 1000, five_hour: { used_percentage: 10 }, seven_day: { used_percentage: 10 } }
const cfg = { autoRefresh: 'full' as const, staleDays: 7 }
const noEnv = () => undefined
const run = (o: { cfg?: object; cursor?: unknown; usage?: unknown; env?: (k: string) => string | undefined; lock?: { startedAt: string } | null } = {}) =>
  shouldSpawn({ ...cfg, ...o.cfg }, 'cursor' in o ? o.cursor : old, 'usage' in o ? o.usage : usage, o.env ?? noEnv, o.lock ?? null, NOW)

test('shouldSpawn table', () => {
  expect(run()).toEqual({ spawn: true, reason: 'stale' })
  expect(run({ env: (k) => (k === 'MORE_LIKE_YOU_CHILD' ? '1' : undefined) }).spawn).toBe(false)
  expect(run({ cfg: { autoRefresh: 'local' } }).spawn).toBe(false)
  expect(run({ cursor: fresh }).spawn).toBe(false)
  expect(run({ lock: { startedAt: ago(10 * MIN) } }).spawn).toBe(false)
  expect(run({ lock: { startedAt: ago(61 * MIN) } }).spawn).toBe(true)
  expect(run({ usage: null }).reason).toBe('usage-missing')
  expect(run({ usage: { ...usage, updated_at: (NOW - 3 * 60 * MIN) / 1000 } }).reason).toBe('usage-stale')
  expect(run({ usage: { ...usage, five_hour: { used_percentage: 50 } } }).spawn).toBe(false)
  expect(run({ usage: { ...usage, five_hour: { used_percentage: 49 } } }).spawn).toBe(true)
  expect(run({ usage: { ...usage, seven_day: { used_percentage: 95 } } }).spawn).toBe(false)
  expect(run({ cursor: null })).toEqual({ spawn: false, reason: 'no-cursor' })
  expect(run({ cursor: undefined }).reason).toBe('no-cursor')
})

test('shouldSpawn skips plan mode and allows the other modes', () => {
  const at = (mode: string) => shouldSpawn(cfg, old, usage, noEnv, null, NOW, mode)
  expect(at('plan')).toEqual({ spawn: false, reason: 'plan-mode' })
  for (const m of ['default', 'acceptEdits', 'auto', 'dontAsk']) expect(at(m).spawn).toBe(true)
})

test('refreshCommand passes the permission mode, default when unknown', () => {
  expect(refreshCommand('/v/l', 'acceptEdits')).toContain('-p "/more-like-you refresh" --permission-mode acceptEdits --allowedTools')
  expect(refreshCommand('/v/l')).toContain('--permission-mode default ')
  expect(refreshCommand('/v/l', 'plan; rm -rf ~')).toContain('--permission-mode default ')
})

test('lockHeld: young held, 30 min stale, missing free', () => {
  expect(lockHeld({ startedAt: ago(5 * MIN) }, NOW, 30 * MIN)).toBe(true)
  expect(lockHeld({ startedAt: ago(31 * MIN) }, NOW, 30 * MIN)).toBe(false)
  expect(lockHeld(null, NOW, 30 * MIN)).toBe(false)
})

test('refreshCommand is detached, child-flagged and read-only', () => {
  const cmd = refreshCommand('/v/.refresh.lock')
  expect(cmd).toContain('MORE_LIKE_YOU_CHILD=1 nohup claude -p "/more-like-you refresh"')
  expect(cmd).toContain('rm -f "/v/.refresh.lock"')
  expect(cmd).toContain('Bash(gh api -X GET:*)')
  expect(cmd).toContain('mcp__agent-more-like-you__more_like_you')
  expect(cmd).toContain('mcp__claude_ai_Atlassian_MCP__getJiraIssue')
  expect(cmd).toContain('mcp__claude_ai_Slack__slack_search_public_and_private')
  expect(cmd.endsWith('&')).toBe(true)
  expect(cmd).not.toMatch(/send_message|schedule_message|create_canvas|executeWrite|executeDestructive|addOrEdit|create(Jira|Confluence)/)
})
