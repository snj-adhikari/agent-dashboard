import { execFile } from 'child_process'
import { promisify } from 'util'
import { createWorktreeSession } from '../newSession'
import { openClaudeTab, sendToWorkspace } from '../cmuxControl'
import { resolveBranchName } from './branchName'
import { baseBranchFor } from './repoMatch'
import { pickSessionTarget, repoSessions } from './sessionTarget'
import { log } from './logger'
import type { HookStart, TriggerEvent } from './types'

const execFileAsync = promisify(execFile)

/** Read by the agent-monitor-hook mod when it is installed; ignored otherwise. */
function sessionEnv(hookName: string, event: TriggerEvent, branch?: string): Record<string, string> {
  const env: Record<string, string> = { AGENT_MONITOR_HOOK: hookName, AGENT_MONITOR_TICKET: event.id }
  if (branch) env.AGENT_MONITOR_BRANCH = branch
  return env
}

/** The event could not run yet and should go back on the queue. */
export class DeferredError extends Error {}

/** Session commands go back on the queue on any failure, since a closed tab or git error is usually transient. */
export function shouldRequeue(event: TriggerEvent, e: unknown): boolean {
  return e instanceof DeferredError || event.action === 'session-command'
}

export async function executeEvent(hookName: string, event: TriggerEvent): Promise<HookStart> {
  if (!event.repoHint) throw new Error(`no repo mapping for ${event.title} — add it in Setup`)
  const at = new Date().toISOString()

  if (event.action === 'session-command') {
    const target = pickSessionTarget(repoSessions(event.repoHint))
    if (target.kind === 'defer') throw new DeferredError(target.reason)
    if (target.kind === 'send') {
      sendToWorkspace(target.ref, event.context)
      log(`${hookName}: sent command for ${event.id} to ${target.ref} (${target.pct}% context)`)
      return { id: event.id, title: event.title, ref: target.ref, url: event.details?.url, at, reused: true }
    }
  }

  if (event.action === 'command' || event.action === 'session-command') {
    const ref = openClaudeTab(`[hook:${hookName}] ${event.title}`, event.repoHint, event.context, sessionEnv(hookName, event))
    log(`${hookName}: ran command for ${event.id} in ${event.repoHint} (${ref})`)
    return { id: event.id, title: event.title, ref, url: event.details?.url, at }
  }

  await execFileAsync('git', ['-C', event.repoHint, 'fetch', 'origin', '--quiet'], { timeout: 120_000 })
  const branch = resolveBranchName(event.repoHint, event.branch || `tech/${event.source}-${event.id}`)
  const ref = createWorktreeSession(event.repoHint, branch, {
    tabName: `[hook:${hookName}] ${branch}`,
    base: baseBranchFor(event.repoHint, event.title),
    prompt: event.context,
    env: sessionEnv(hookName, event, branch)
  })
  log(`${hookName}: started ${branch} in ${event.repoHint} (${ref})`)
  return { id: event.id, title: event.title, ref, branch, url: event.details?.url, at }
}
