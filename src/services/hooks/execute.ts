import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import { createWorktreeSession, worktreePathFor } from '../newSession'
import { openClaudeTab, sendToWorkspace, terminalBackend } from '../terminal'
import { claudeCommand, openInTitledWorkspace } from '../cmuxControl'
import { HerdrError, SNJ_TERM, parseHerdrRef, promptHerdrAgent, ticketOf, ticketRef, type TicketOutput } from '../herdr'
import { herdrHookRefs, setHerdrHookRefs } from './state'
import { findTicketWork, resolveBranchName } from './branchName'
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

export const PR_REVIEW_WORKSPACE = 'Drive - PR Review'

export const relaySeed = (context: string): string => (context.startsWith('/') ? context : `[relay agent-monitor] ${context}`)

async function openViaSnjTerm(hookName: string, event: TriggerEvent, branch: string, base?: string): Promise<string | undefined> {
  if (!event.repoHint || ticketOf(event.id) !== event.id) return undefined
  const args = ['ticket', '--repos', `${event.repoHint}:${branch}`, '--key', event.id, '--task', event.title, ...(base ? ['--base', base] : []), '--seed', relaySeed(event.context)]
  const envArgs = Object.entries(sessionEnv(hookName, event, branch)).flatMap(([k, v]) => ['--env', `${k}=${v}`])
  const run = (extra: string[]) => execFileAsync(SNJ_TERM, [...args, ...extra], { timeout: 180_000 })
  try {
    const { stdout } = await run(envArgs).catch((e: { stdout?: string }) => {
      if (String(e.stdout || '').includes('unknown option --env')) return run([])
      throw e
    })
    const out = JSON.parse(stdout) as TicketOutput
    const ref = ticketRef(out)
    if (ref && parseHerdrRef(ref)) setHerdrHookRefs([...herdrHookRefs(), ref])
    return ref
  } catch (e) {
    const reason = (e as Error).message.split('\n')[0]
    const wt = worktreePathFor(event.repoHint, branch)
    if (fs.existsSync(wt)) throw new Error(`snj-term ticket failed after creating ${wt}, not opening a second session: ${reason}`)
    log(`${hookName}: snj-term ticket failed for ${event.id}, using a cmux tab: ${reason}`)
    return undefined
  }
}

/** The event could not run yet and should go back on the queue. */
export class DeferredError extends Error {}

/** The event needs no session, e.g. work for its ticket already exists. */
export class SkippedError extends Error {}

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
      const pane = parseHerdrRef(target.ref)
      try {
        if (pane) await promptHerdrAgent(pane.session, pane.paneId, `[relay agent-monitor] ${event.context}`)
        else sendToWorkspace(target.ref, event.context)
      } catch (e) {
        if (e instanceof HerdrError && e.code === 'agent_blocked') throw new DeferredError(`${target.ref} is blocked`)
        throw e
      }
      log(`${hookName}: sent command for ${event.id} to ${target.ref} (${target.pct}% context)`)
      return { id: event.id, title: event.title, ref: target.ref, url: event.details?.url, at, reused: true }
    }
  }

  if (event.action === 'command' && event.source === 'slack-pr-review' && terminalBackend() === 'cmux') {
    const ref = openInTitledWorkspace(PR_REVIEW_WORKSPACE, event.repoHint, claudeCommand(event.context, sessionEnv(hookName, event)))
    log(`${hookName}: ran command for ${event.id} in ${PR_REVIEW_WORKSPACE} (${ref})`)
    return { id: event.id, title: event.title, ref, url: event.details?.url, at }
  }

  if (event.action === 'command' || event.action === 'session-command') {
    const ref = openClaudeTab(`[hook:${hookName}] ${event.title}`, event.repoHint, event.context, sessionEnv(hookName, event))
    log(`${hookName}: ran command for ${event.id} in ${event.repoHint} (${ref})`)
    return { id: event.id, title: event.title, ref, url: event.details?.url, at }
  }

  await execFileAsync('git', ['-C', event.repoHint, 'fetch', 'origin', '--quiet'], { timeout: 120_000 })
  if (event.source === 'jira') {
    const existing = findTicketWork(event.repoHint, event.id)
    if (existing) throw new SkippedError(`${existing} already exists`)
  }
  const branch = resolveBranchName(event.repoHint, event.branch || `tech/${event.source}-${event.id}`)
  const base = baseBranchFor(event.repoHint, event.title)
  const ref =
    (await openViaSnjTerm(hookName, event, branch, base)) ||
    createWorktreeSession(event.repoHint, branch, {
      tabName: `[hook:${hookName}] ${branch}`,
      base,
      prompt: event.context,
      env: sessionEnv(hookName, event, branch)
    })
  log(`${hookName}: started ${branch} in ${event.repoHint} (${ref})`)
  return { id: event.id, title: event.title, ref, branch, url: event.details?.url, at }
}
