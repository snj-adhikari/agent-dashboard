import type { EngineInterface as Ctx } from 'claude-code'
import { ingest } from './ingest'

interface Config { autoRefresh?: 'local' | 'full'; staleDays: number }
type Lock = { startedAt: string } | null

const MIN = 60_000
const LEARN_STALE = 30 * MIN
const REFRESH_STALE = 60 * MIN
const USAGE_STALE = 120 * MIN
const SOURCES = ['slack', 'jira', 'confluence', 'github']
const MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto']
export const modeOf = (m: unknown): string => (typeof m === 'string' && MODES.includes(m) ? m : 'default')

const ALLOWED = [
  'mcp__claude_ai_Slack__slack_search_public_and_private',
  'mcp__claude_ai_Slack__slack_search_public',
  'mcp__claude_ai_Slack__slack_read_channel',
  'mcp__claude_ai_Slack__slack_read_thread',
  'mcp__claude_ai_Slack__slack_read_user_profile',
  'mcp__claude_ai_Atlassian_MCP__searchJiraIssuesUsingJql',
  'mcp__claude_ai_Atlassian_MCP__getJiraIssue',
  'mcp__claude_ai_Atlassian_MCP__executeRead',
  'mcp__claude_ai_Atlassian_MCP__atlassianUserInfo',
  'mcp__claude_ai_Atlassian_MCP__getAccessibleAtlassianResources',
  'mcp__claude_ai_Atlassian_MCP__searchConfluence',
  'mcp__claude_ai_Atlassian_MCP__getConfluenceContent',
  'mcp__agent-more-like-you__more_like_you',
  'Bash(gh api -X GET:*)',
].join(',')

async function readLock($: Ctx, path: string): Promise<Lock> {
  try {
    const l = JSON.parse(await $.fs.read(path)) as { startedAt?: string }
    return typeof l.startedAt === 'string' ? { startedAt: l.startedAt } : null
  } catch {
    return null
  }
}

export const lockHeld = (l: Lock, now: number, staleMs: number) => age(l, now) < staleMs
const age = (l: Lock, now: number) => (l ? now - Date.parse(l.startedAt) : Infinity)

export async function localLearn($: Ctx, folder: string, vaultRoot: string | null, full = false): Promise<string> {
  const path = `${folder}/.learn.lock`
  const now = await $.clock.now()
  if (lockHeld(await readLock($, path), now, LEARN_STALE)) return 'locked'
  await $.fs.write(path, JSON.stringify({ startedAt: new Date(now).toISOString() }))
  try {
    return await ingest($, folder, (await $.env.get('HOME')) ?? '', vaultRoot, full)
  } finally {
    await $.fs.write(path, '{}')
  }
}

export function shouldSpawn(
  cfg: Config,
  cursor: unknown,
  usage: unknown,
  env: (k: string) => string | undefined,
  lock: Lock,
  now: number,
  mode = 'default',
): { spawn: boolean; reason: string } {
  const no = (reason: string) => ({ spawn: false, reason })
  if (env('MORE_LIKE_YOU_CHILD') === '1') return no('child')
  if (cfg.autoRefresh !== 'full') return no('local-mode')
  if (mode === 'plan') return no('plan-mode')
  if (!cursor || typeof cursor !== 'object') return no('no-cursor')
  const c = (cursor ?? {}) as Record<string, string | undefined>
  const limit = cfg.staleDays * 24 * 60 * MIN
  if (SOURCES.every((s) => c[s] && now - Date.parse(c[s]!) < limit)) return no('fresh')
  if (age(lock, now) < REFRESH_STALE) return no('refresh-locked')
  const u = usage as { updated_at?: number; five_hour?: { used_percentage?: number }; seven_day?: { used_percentage?: number } } | null
  if (!u || typeof u !== 'object') return no('usage-missing')
  if (typeof u.updated_at !== 'number' || now - u.updated_at * 1000 > USAGE_STALE) return no('usage-stale')
  if ((u.five_hour?.used_percentage ?? 0) >= 50) return no('usage-5h')
  if ((u.seven_day?.used_percentage ?? 0) >= 95) return no('usage-7d')
  return { spawn: true, reason: 'stale' }
}

export const refreshCommand = (lock: string, mode = 'default') =>
  `( MORE_LIKE_YOU_CHILD=1 nohup claude -p "/more-like-you refresh" --permission-mode ${modeOf(mode)} --allowedTools "${ALLOWED}" >/dev/null 2>&1 </dev/null; rm -f "${lock}" ) >/dev/null 2>&1 </dev/null &`

export async function spawnRefresh($: Ctx, folder: string, mode = 'default'): Promise<void> {
  const lock = `${folder}/.refresh.lock`
  await $.fs.write(lock, JSON.stringify({ startedAt: new Date(await $.clock.now()).toISOString() }))
  await $.process.run(['/bin/sh', '-c', refreshCommand(lock, mode)], { timeoutMs: 10_000 })
}
