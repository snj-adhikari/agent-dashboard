import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { SESSION_RE, TARGET_RE } from '../herdr'
import { isSurfaceRef, isWorkspaceRef } from '../cmuxControl'
import type { Agent } from './agents'

export type ErrorCode = 'unauthorised' | 'unknown_agent' | 'stale' | 'cannot_send' | 'grant_in_terminal' | 'bad_request' | 'host_failed'

const STATUS: Record<ErrorCode, number> = { unauthorised: 401, unknown_agent: 404, stale: 409, cannot_send: 422, grant_in_terminal: 403, bad_request: 400, host_failed: 502 }

export class CuckooError extends Error {
  readonly status: number
  constructor(readonly code: ErrorCode, message: string) {
    super(message)
    this.status = STATUS[code]
  }
}

export interface Address {
  host: 'herdr' | 'herdr-app' | 'cmux' | 'tmux'
  session: string
  pane: string
}

/** Agent ids are `host:session:pane`; herdr panes (`w1:p2`) and cmux refs (`workspace:3`) carry colons of their own. */
export function addressOf(agent: Pick<Agent, 'id' | 'host'>): Address {
  const id = agent.id
  let m: RegExpExecArray | null
  if (agent.host === 'herdr' && (m = /^herdr:([^:]+):(.+)$/.exec(id)) && SESSION_RE.test(m[1]) && TARGET_RE.test(m[2])) return { host: 'herdr', session: m[1], pane: m[2] }
  if (agent.host === 'herdr-app' && (m = /^herdr-app:([^:]+):(t[0-9a-z]+)$/.exec(id))) return { host: 'herdr-app', session: m[1], pane: m[2] }
  if (agent.host === 'cmux' && (m = /^cmux:(workspace:\d+|[0-9A-Fa-f-]{36}):?(.*)$/.exec(id)) && isWorkspaceRef(m[1]) && (!m[2] || isSurfaceRef(m[2]))) return { host: 'cmux', session: m[1], pane: m[2] }
  if (agent.host === 'tmux' && (m = /^tmux:([A-Za-z0-9._-]+):?(.*)$/.exec(id))) return { host: 'tmux', session: m[1], pane: m[2] }
  throw new CuckooError('cannot_send', `cannot send to ${agent.host} agent ${id}`)
}

export const normalise = (text: string): string => text.replace(/\s+/g, ' ').trim()

export const textHash = (text: string): string => crypto.createHash('sha256').update(normalise(text)).digest('hex')

export const shortHash = (text: string): string => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16)

/** Same keys the terminal-side gates look up: hc terminal id, `<session>-<pane>` for herdr, cmux surface id. */
export function relayKey(agent: Pick<Agent, 'id' | 'host'>): string {
  const a = addressOf(agent)
  const key = a.host === 'herdr' ? `${a.session}-${a.pane}` : a.host === 'herdr-app' ? a.pane : a.pane || a.session
  return key.replace(/[^\w.:-]/g, '_')
}

export const relayDir = (): string => process.env.CUCKOO_RELAY_DIR || path.join(os.homedir(), '.claude', 'agent-relays')

/** Appends the main-agent relay line before anything is typed, so gates treat the text as the user's own handoff. */
export function logRelay(key: string, text: string, dir = relayDir()): string {
  const sha256 = textHash(text)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = path.join(dir, `${key}.jsonl`)
  fs.appendFileSync(file, `${JSON.stringify({ ts: Math.floor(Date.now() / 1000), from: 'agent-cuckoo', sha256, main: true })}\n`, { mode: 0o600 })
  fs.chmodSync(file, 0o600)
  return sha256
}
