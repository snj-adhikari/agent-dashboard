import path from 'path'
import { jiraHook, jiraEventForKey, workTypes } from './jiraHook'
import { slackPrReviewHook } from './slackPrReviewHook'
import { jiraMentionPrHook } from './jiraMentionPrHook'
import { checkPollGate, checkStartGate, fiveHourUsage, sessionUsageHalt } from './usageGate'
import { addOverrideRef, autoDisable, autoDisableDecision, autoDisabledHooks, clearAutoDisable, dequeue, disabledHooks, enqueue, haltedRefs, idleCount, isNew, markSeen, nextIdleCount, overrideRefs, pausedHooks, queued, recordIdle, requeue, setHalted, shouldAutoEnable } from './state'
import { DeferredError, SkippedError, executeEvent, shouldRequeue } from './execute'
import { recordStart, updateStatus } from './status'
import { loadConfig, pollIntervalMin } from './config'
import { OpLockedError } from './op'
import { openOpUnlockTab, sendKey, sendToWorkspace, terminalTabs } from '../terminal'
import { log, logError } from './logger'
import { HOOK_TAB_PREFIX } from './types'
import type { HookStart, Trigger } from './types'

const HOOKS: Trigger[] = [jiraHook, slackPrReviewHook, jiraMentionPrHook]
const DRAIN_INTERVAL_MS = 5 * 60_000
const FIVE_HOURS_S = 5 * 60 * 60

export function hookNames(): string[] {
  return HOOKS.map((h) => h.name)
}

function errorMessage(e: unknown): string {
  const err = e as { stderr?: string; message?: string }
  return (err.stderr || err.message || String(e)).toString().trim().slice(0, 300)
}

function activeHookTabs(): string[] {
  return terminalTabs()
    .filter((t) => t.title.startsWith(HOOK_TAB_PREFIX))
    .map((t) => t.ref)
}

function refreshGateStatus(): boolean {
  const gate = checkStartGate()
  for (const hook of HOOKS) updateStatus(hook.name, { usageGateOk: gate.ok, gateReason: gate.reason })
  return gate.ok
}

// Polls keep running while starts are gated, so tickets found at >50% wait in the queue.
async function pollHook(hook: Trigger): Promise<void> {
  if (pausedHooks().includes(hook.name)) return
  const gate = checkPollGate()
  updateStatus(hook.name, { lastPollAt: new Date().toISOString() })
  if (!gate.ok) {
    log(`${hook.name}: poll skipped — ${gate.reason}`)
    return
  }
  try {
    const batch = (await hook.poll()).sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2))
    let added = 0
    for (const event of batch) {
      if (isNew(hook.name, event.id)) {
        enqueue(hook.name, event)
        added++
      }
    }
    applyAutoDisable(hook.name, added)
    updateStatus(hook.name, { lastError: null })
  } catch (e) {
    if (e instanceof OpLockedError) {
      updateStatus(hook.name, { lastError: '1Password locked — unlock tab opened' })
      openOpUnlockTab()
      return
    }
    logError(`${hook.name}: ${errorMessage(e)}`)
    updateStatus(hook.name, { lastError: errorMessage(e) })
  }
}

function applyAutoDisable(hook: string, added: number): void {
  const usage = fiveHourUsage()
  const idle = nextIdleCount(idleCount(hook), added, usage?.pct ?? 0)
  recordIdle(hook, idle)
  const until = usage?.resetsAt ?? Date.now() / 1000 + FIVE_HOURS_S
  const reason = autoDisableDecision(idle, queued().length)
  if (reason) log(`${reason === 'queue' ? 'all hooks' : hook}: polling auto-paused (${reason})`)
  if (reason === 'queue') autoDisable(hookNames(), reason, until)
  else if (reason === 'idle') autoDisable([hook], reason, until)
}

function autoEnable(): void {
  const now = Date.now() / 1000
  const length = queued().length
  const ready = Object.entries(autoDisabledHooks())
    .filter(([, entry]) => shouldAutoEnable(entry, now, length))
    .map(([hook]) => hook)
  if (!ready.length) return
  clearAutoDisable(ready)
  log(`${ready.join(', ')}: polling auto-resumed`)
}

// Queued work starts one at a time, only while fewer than maxConcurrent hook tabs are open; at most one session command per tick.
async function drainQueue(): Promise<void> {
  if (!refreshGateStatus()) return
  let sessionCommandTried = false
  while (queued().length && activeHookTabs().length < loadConfig().maxConcurrent) {
    const next = dequeue(undefined, disabledHooks(), sessionCommandTried ? ['session-command'] : [])
    if (!next) return
    if (next.event.action === 'session-command') sessionCommandTried = true
    try {
      recordStart(next.hook, await executeEvent(next.hook, next.event))
    } catch (e) {
      if (e instanceof SkippedError) {
        log(`${next.hook}: skipped ${next.event.id}: ${e.message}`)
        continue
      }
      if (shouldRequeue(next.event, e)) requeue(next)
      if (e instanceof DeferredError) {
        log(`${next.hook}: deferred ${next.event.id}: ${e.message}`)
        continue
      }
      logError(`${next.hook}: ${next.event.id}: ${errorMessage(e)}`)
      updateStatus(next.hook, { lastEvent: next.event.title, lastError: `${next.event.id}: ${errorMessage(e)}` })
    }
  }
}

function haltOnSessionUsage(): void {
  if (!sessionUsageHalt()) {
    if (haltedRefs().length) setHalted([])
    return
  }
  const active = activeHookTabs()
  const skip = [...haltedRefs(), ...overrideRefs()]
  const toHalt = active.filter((ref) => !skip.includes(ref))
  for (const ref of toHalt) {
    sendKey(ref, 'escape')
    sendToWorkspace(
      ref,
      `STOP: 5-hour usage reached ${loadConfig().gate.fiveHourPct}%. Do not start any new step. Leave the worktree as-is, print a one-line status of where you stopped, and wait for my instruction.`
    )
    log(`halted ${ref}: 5h usage over limit`)
  }
  if (toHalt.length) setHalted([...haltedRefs(), ...toHalt])
}

let draining = false
let pollChain: Promise<void> = Promise.resolve()
const pollTimers = new Map<string, NodeJS.Timeout>()

/** Each hook polls on its own interval, but one at a time so two `claude -p` polls never overlap. */
function queuePoll(hook: Trigger): Promise<void> {
  pollChain = pollChain.then(() => pollHook(hook)).catch((e) => logError(`${hook.name}: ${errorMessage(e)}`))
  return pollChain
}

function scheduleHook(name: string): void {
  const hook = HOOKS.find((h) => h.name === name)
  if (!hook) return
  clearInterval(pollTimers.get(name))
  pollTimers.set(name, setInterval(() => queuePoll(hook), pollIntervalMin(name) * 60_000))
}

/** Applies a changed interval; a no-op when polling never started (DISABLE_HOOKS). */
export function rescheduleHook(name: string): void {
  if (pollTimers.has(name)) scheduleHook(name)
}

async function drainTick(): Promise<void> {
  if (draining) return
  draining = true
  try {
    haltOnSessionUsage()
    autoEnable()
    await drainQueue()
  } catch (e) {
    logError(`drain: ${errorMessage(e)}`)
  } finally {
    draining = false
  }
}

export interface QueueItem {
  hook: string
  id: string
  title: string
  urgent: boolean
  priority: string
  type: string
  repo: string
  branch: string
  url?: string
  queuedAt: string
}

export function queueItems(): QueueItem[] {
  return queued().map((q) => ({
    hook: q.hook,
    id: q.event.id,
    title: q.event.title,
    urgent: (q.event.priority ?? 2) <= 1,
    priority: q.event.details?.priority || '',
    type: q.event.details?.type || q.event.action,
    repo: q.event.repoHint ? path.basename(q.event.repoHint) : 'no repo mapping',
    branch: q.event.branch || '',
    url: q.event.details?.url,
    queuedAt: q.queuedAt
  }))
}

/** Dashboard "Run now": the user's explicit override of the gate, slot limit and auto-halt. */
export async function runQueued(id?: string): Promise<HookStart> {
  const item = dequeue(id)
  if (!item) throw new Error(id ? `${id} is not in the queue` : 'queue is empty')
  try {
    const start = await executeEvent(item.hook, item.event)
    if (!start.reused) addOverrideRef(start.ref)
    recordStart(item.hook, start)
    return start
  } catch (e) {
    if (!(e instanceof SkippedError)) requeue(item)
    throw e
  }
}

export interface ManualStartResult {
  queued: boolean
  reason?: string
  start?: HookStart
}

/** User-initiated start for one ticket: bypasses the lookback window; queued instead if the gate or slots are full. */
export async function startJiraTicket(key: string): Promise<ManualStartResult> {
  const event = await jiraEventForKey(key)
  if (!event) throw new Error(`${key} is not a startable ${workTypes().join(' / ')} / spike Task`)
  if (!isNew(jiraHook.name, event.id)) throw new Error(`${key} was already started or queued by the jira hook`)
  const gate = checkStartGate()
  const full = activeHookTabs().length >= loadConfig().maxConcurrent
  if (!gate.ok || full) {
    enqueue(jiraHook.name, event)
    return { queued: true, reason: gate.reason || `${loadConfig().maxConcurrent} hook sessions already running` }
  }
  const start = await executeEvent(jiraHook.name, event)
  markSeen(jiraHook.name, event.id)
  recordStart(jiraHook.name, start)
  return { queued: false, start }
}

export function startHookPolling(): void {
  refreshGateStatus()
  Promise.all(HOOKS.map(queuePoll)).then(drainTick)
  for (const hook of HOOKS) scheduleHook(hook.name)
  setInterval(drainTick, DRAIN_INTERVAL_MS)
}
