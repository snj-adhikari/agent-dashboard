import fs from 'fs'
import path from 'path'
import { log } from './logger'
import type { TriggerEvent } from './types'

const STATE_PATH = path.join(__dirname, '..', '..', '..', 'hooks-state.json')

export interface QueuedEvent {
  hook: string
  event: TriggerEvent
  queuedAt: string
}

export interface AutoDisable {
  reason: 'idle' | 'queue'
  until: number
}

interface HookState {
  seen: Record<string, string[]>
  queue: QueuedEvent[]
  halted: string[]
  overrides: string[]
  disabled: string[]
  autoDisabled: Record<string, AutoDisable>
  idleCount: Record<string, number>
}

function empty(): HookState {
  return { seen: {}, queue: [], halted: [], overrides: [], disabled: [], autoDisabled: {}, idleCount: {} }
}

function read(): HookState {
  try {
    return { ...empty(), ...JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) }
  } catch {
    return empty()
  }
}

function write(state: HookState): void {
  const tmp = `${STATE_PATH}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2))
  fs.renameSync(tmp, STATE_PATH)
}

export function isNew(hook: string, id: string): boolean {
  return !(read().seen[hook] || []).includes(id)
}

export function markSeen(hook: string, id: string): void {
  const state = read()
  write({ ...state, seen: { ...state.seen, [hook]: [...(state.seen[hook] || []), id].slice(-500) } })
}

export function enqueue(hook: string, event: TriggerEvent): void {
  const state = read()
  const seen = { ...state.seen, [hook]: [...(state.seen[hook] || []), event.id].slice(-500) }
  write({ ...state, seen, queue: [...state.queue, { hook, event, queuedAt: new Date().toISOString() }] })
}

export const SESSION_COMMAND_TTL_MS = 24 * 60 * 60 * 1000

export function expired(item: QueuedEvent, now: number): boolean {
  return item.event.action === 'session-command' && now - Date.parse(item.queuedAt) > SESSION_COMMAND_TTL_MS
}

/** Inserts the item back at its original arrival position. */
export function insertByQueuedAt(queue: QueuedEvent[], item: QueuedEvent): QueuedEvent[] {
  const i = queue.findIndex((q) => q.queuedAt > item.queuedAt)
  return i < 0 ? [...queue, item] : [...queue.slice(0, i), item, ...queue.slice(i)]
}

/** Puts a dequeued item back unchanged, without re-marking it seen; expired session commands are dropped. */
export function requeue(item: QueuedEvent, now = Date.now()): void {
  if (expired(item, now)) return log(`${item.hook}: dropped ${item.event.id}, queued at ${item.queuedAt} (over 24h)`)
  const state = read()
  write({ ...state, queue: insertByQueuedAt(state.queue, item) })
}

export function queued(): QueuedEvent[] {
  return queueOrder(read().queue)
}

const URGENT_RANK = 1

function isUrgent(q: QueuedEvent): boolean {
  return (q.event.priority ?? 2) <= URGENT_RANK
}

/** FIFO, except urgent items (Blocker/Highest/Critical/High) jump ahead, FIFO among themselves. */
export function queueOrder(queue: QueuedEvent[]): QueuedEvent[] {
  return [...queue.filter(isUrgent), ...queue.filter((q) => !isUrgent(q))]
}

/** Queue order, minus items whose hook is disabled or whose action is skipped; those stay queued. */
export function runnableOrder(queue: QueuedEvent[], disabled: string[], skipActions: string[] = []): QueuedEvent[] {
  return queueOrder(queue).filter((q) => !disabled.includes(q.hook) && !skipActions.includes(q.event.action))
}

/** Removes and returns the given item, or the next runnable one (skipping `skipHooks`/`skipActions`) when no id is given. */
export function dequeue(id?: string, skipHooks: string[] = [], skipActions: string[] = []): QueuedEvent | undefined {
  const state = read()
  const next = id ? state.queue.find((q) => q.event.id === id) : runnableOrder(state.queue, skipHooks, skipActions)[0]
  if (next) write({ ...state, queue: state.queue.filter((q) => q !== next) })
  return next
}

export function haltedRefs(): string[] {
  return read().halted
}

export function setHalted(refs: string[]): void {
  write({ ...read(), halted: refs })
}


/** Tabs the user explicitly ran from the dashboard; exempt from the usage auto-halt. */
export function overrideRefs(): string[] {
  return read().overrides
}

export function addOverrideRef(ref: string): void {
  const state = read()
  write({ ...state, overrides: [...state.overrides, ref].slice(-50) })
}

export function disabledHooks(): string[] {
  return read().disabled
}

export function setHookEnabled(hook: string, enabled: boolean): void {
  const state = read()
  const disabled = state.disabled.filter((h) => h !== hook)
  if (!enabled) return write({ ...state, disabled: [...disabled, hook] })
  const { [hook]: _auto, ...autoDisabled } = state.autoDisabled
  write({ ...state, disabled, autoDisabled, idleCount: { ...state.idleCount, [hook]: 0 } })
}

export function enabledHooks<T extends { name: string }>(hooks: T[], disabled: string[]): T[] {
  return hooks.filter((h) => !disabled.includes(h.name))
}

export const AUTO_IDLE_PCT = 50
export const AUTO_IDLE_POLLS = 2
export const AUTO_QUEUE_LIMIT = 4

/** Consecutive empty polls while 5h usage is over the idle threshold; anything else resets it. */
export function nextIdleCount(count: number, queuedCount: number, fiveHourPct: number): number {
  return fiveHourPct > AUTO_IDLE_PCT && queuedCount === 0 ? count + 1 : 0
}

/** 'queue' pauses every hook, 'idle' only the hook that polled. */
export function autoDisableDecision(idleCount: number, queueLength: number): AutoDisable['reason'] | null {
  if (queueLength > AUTO_QUEUE_LIMIT) return 'queue'
  return idleCount >= AUTO_IDLE_POLLS ? 'idle' : null
}

export function shouldAutoEnable(entry: AutoDisable, nowS: number, queueLength: number): boolean {
  return nowS >= entry.until || (entry.reason === 'queue' && queueLength <= AUTO_QUEUE_LIMIT)
}

export function pollingPaused(disabled: string[], autoDisabled: Record<string, AutoDisable>): string[] {
  return [...new Set([...disabled, ...Object.keys(autoDisabled)])]
}

export function autoDisabledHooks(): Record<string, AutoDisable> {
  return read().autoDisabled
}

export function pausedHooks(): string[] {
  const state = read()
  return pollingPaused(state.disabled, state.autoDisabled)
}

export function recordIdle(hook: string, count: number): void {
  const state = read()
  write({ ...state, idleCount: { ...state.idleCount, [hook]: count } })
}

export function idleCount(hook: string): number {
  return read().idleCount[hook] || 0
}

/** Existing entries are kept so an idle pause is not downgraded to a queue pause. */
export function autoDisable(hooks: string[], reason: AutoDisable['reason'], until: number): void {
  const state = read()
  const added = Object.fromEntries(hooks.filter((h) => !state.autoDisabled[h]).map((h) => [h, { reason, until }]))
  const idle = Object.fromEntries(hooks.map((h) => [h, 0]))
  write({ ...state, autoDisabled: { ...added, ...state.autoDisabled }, idleCount: { ...state.idleCount, ...idle } })
}

export function clearAutoDisable(hooks: string[]): void {
  const state = read()
  write({ ...state, autoDisabled: Object.fromEntries(Object.entries(state.autoDisabled).filter(([h]) => !hooks.includes(h))) })
}
