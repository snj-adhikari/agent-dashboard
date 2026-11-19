import { execFileSync } from 'child_process'
import type { IncomingMessage, ServerResponse } from 'http'
import { herdrSnapshot, refreshHerdr, type HerdrSnapshot } from '../services/herdr'
import { terminalBackend, terminalTabs } from '../services/terminal'
import { allBareProcesses } from '../services/processes'
import { parseProcTree, toAgents, type Agent, type CmuxSurfaces, type SessionInfo } from '../services/cuckoo/agents'
import { liveSessions } from '../services/hooks/sessions'
import { claimKey, readClaims, type Claims } from '../services/cuckoo/mainClaims'
import { claudeUsage } from '../services/cuckoo/usage'
import { localClis } from '../services/cuckoo/clis'
import type { CmuxTab } from '../types'
import { requireToken } from '../services/cuckoo/token'
import { io } from '../services/cuckoo/keys'
import { approvalsFor } from '../services/cuckoo/promptParse'
import { repliesFor } from '../services/cuckoo/replyParse'
import { handleCuckooAction } from './cuckooActions'
import { handleCuckooSide } from './cuckooSide'
import { currentMusic } from '../services/cuckoo/side/music'
import { readSettings } from '../services/cuckoo/side/config'

export const CUCKOO_PREFIX = '/api/v1/cuckoo/'

/** Island polling must not count as a dashboard client being seen. */
export const isCuckooPath = (pathname: string): boolean => pathname.startsWith(CUCKOO_PREFIX)

export function sendError(res: ServerResponse, status: number, error: string, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: false, error, message }))
}

function json(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

const cmuxJson = <T>(args: string[]): T => JSON.parse(execFileSync('cmux', ['--json', ...args], { encoding: 'utf8', timeout: 3000 })) as T

/** Read-only surface listing, only for workspaces that hold a claim, so a poll costs nothing when no cmux main exists. */
function claimedSurfaces(tabs: CmuxTab[], claims: Claims): CmuxSurfaces {
  const out: CmuxSurfaces = {}
  for (const t of tabs) {
    if (!t.id || !claims[claimKey(`cmux:${t.id}`)]) continue
    try {
      const { panes } = cmuxJson<{ panes: { ref: string }[] }>(['list-panes', '--workspace', t.ref])
      out[t.ref] = panes.flatMap((p) => cmuxJson<{ surfaces: { id?: string; ref: string }[] }>(['list-pane-surfaces', '--workspace', t.ref, '--pane', p.ref]).surfaces.flatMap((s) => [s.ref, s.id || '']).filter(Boolean))
    } catch {
      continue
    }
  }
  return out
}

/** One `ps` call gives both the host app ancestry and which reported session pids are still running. */
function sessionInfo(): SessionInfo {
  let tree: SessionInfo['tree']
  try {
    tree = parseProcTree(execFileSync('ps', ['-A', '-o', 'pid=,ppid=,comm='], { encoding: 'utf8', timeout: 3000, maxBuffer: 10 * 1024 * 1024 }))
  } catch {
    return {}
  }
  return { tree, sessions: liveSessions().filter((s) => tree?.has(s.pid)) }
}

export function currentAgents(snap: HerdrSnapshot = herdrSnapshot()): Agent[] {
  const host = terminalBackend() === 'tmux' ? 'tmux' : 'cmux'
  const tabs = terminalTabs()
  const claims = readClaims()
  return toAgents(snap, tabs, allBareProcesses(), claims, host, host === 'cmux' ? claimedSurfaces(tabs, claims) : {}, sessionInfo())
}

/**
 * herdrSnapshot() already starts a shared background refresh once the cache is 3 s old, so each 2 s poll keeps it fresh
 * with no dashboard open; only the never-loaded snapshot is awaited, so the first poll after start isn't empty.
 */
export async function pollSnapshot(get: () => HerdrSnapshot = herdrSnapshot, refresh: () => Promise<HerdrSnapshot> = refreshHerdr): Promise<HerdrSnapshot> {
  const snap = get()
  return snap.at ? snap : refresh()
}

/** Sends re-check against a new discovery pass, not the cached poll, so a moved or renamed agent gives 409. */
io.fresh = async () => currentAgents(await refreshHerdr())

export async function handleCuckoo(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (!requireToken(req, res)) return
  if (await handleCuckooSide(req, res, url.pathname.slice(CUCKOO_PREFIX.length), url)) return
  if (req.method === 'POST' && (await handleCuckooAction(req, res, url))) return
  const route = url.pathname.slice(CUCKOO_PREFIX.length)
  try {
    if (req.method === 'GET' && route === 'state') {
      const agents = currentAgents(await pollSnapshot())
      const [approvals, replies, music] = await Promise.all([approvalsFor(agents), repliesFor(agents), readSettings().enabled.music ? currentMusic().catch(() => null) : null])
      return json(res, { v: 1, ts: Date.now(), agents, approvals, replies, music })
    }
    if (req.method === 'GET' && route === 'usage') return json(res, claudeUsage())
    if (req.method === 'GET' && route === 'clis') return json(res, await localClis())
    sendError(res, 404, 'bad_request', `unknown route ${req.method} ${url.pathname}`)
  } catch (e) {
    sendError(res, 502, 'host_failed', (e as Error).message)
  }
}
