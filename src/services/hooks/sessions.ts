export interface LiveSession {
  sessionId: string
  phase: string
  pid: string
  cwd: string
  workspace: string
  hook: string
  ticket: string
  branch: string
  at: string
}

const sessions = new Map<string, LiveSession>()
const MAX = 200
const FIELD = /^[\w./:@#?=&%+-]{1,300}$/
const PID = /^\d{1,10}$/
const PATH = /^\/[^\0\r\n]{0,500}$/

const clean = (v: unknown): string => (typeof v === 'string' && FIELD.test(v) ? v : '')

/** Input comes from a session's plugin over HTTP, so every field is validated before it is stored or shown. */
export function recordSession(body: Record<string, unknown>): LiveSession | null {
  const sessionId = clean(body.sessionId)
  if (!sessionId) return null
  const pid = typeof body.pid === 'string' && PID.test(body.pid) ? body.pid : ''
  const cwd = typeof body.cwd === 'string' && PATH.test(body.cwd) ? body.cwd : ''
  const entry = {
    sessionId,
    pid,
    cwd,
    workspace: clean(body.workspace),
    ticket: clean(body.ticket),
    hook: clean(body.hook),
    branch: clean(body.branch),
    phase: clean(body.phase) || 'working',
    at: new Date().toISOString()
  }
  const key = pid || sessionId
  sessions.delete(key)
  sessions.set(key, entry)
  if (sessions.size > MAX) sessions.delete(sessions.keys().next().value as string)
  return entry
}

/** Sessions started by a hook, newest first, for the Hooks panel. */
export function hookSessions(): LiveSession[] {
  return [...sessions.values()].filter((s) => s.ticket).reverse()
}

/** Sessions that reported their pid and cwd; the caller drops any whose pid is no longer running. */
export function reportedByPid(): Map<string, LiveSession> {
  return new Map([...sessions.values()].filter((s) => s.pid && s.cwd).map((s) => [s.pid, s]))
}
