import path from 'path'
import type { AgentProcess, CmuxTab, HerdrAgent } from '../../types'
import type { HerdrSnapshot } from '../herdr'
import { claimKey, isMainFor, type Claims } from './mainClaims'

export type AgentState = 'working' | 'waiting' | 'done' | 'unknown'
export type AgentHost = 'herdr' | 'herdr-app' | 'cmux' | 'tmux' | 'bare'

export interface Agent {
  id: string
  name: string
  codename: string | null
  colour: string | null
  state: AgentState
  host: AgentHost
  terminalApp: string | null
  scope: string | null
  space: string
  isMain: boolean
  cwd: string
  branch: string | null
  lastLine: string | null
  cli: string | null
  canSend: boolean
}

export interface ApprovalOption {
  key: string
  label: string
}

export interface Approval {
  id: string
  agentId: string
  tool: string
  command: string
  options: ApprovalOption[]
  receivedAt: number
  screenHash: string
}

export interface Reply {
  id: string
  agentId: string
  codename: string | null
  text: string
  at: number
}

export const BARE_SPACE = 'Bare processes'

const STATES: Record<string, AgentState> = { blocked: 'waiting', working: 'working', done: 'done', idle: 'done' }

export const mapState = (status: string): AgentState => STATES[status] || 'unknown'

const cliOf = (agent: string): string | null => (agent ? agent.replace(/-code$/, '') : null)

function fromHerdr(a: HerdrAgent, claims: Claims): Agent {
  const app = a.host === 'herdr-app' || a.session === 'hc'
  const scope = app ? (a.workspaceId ? `hc:${a.workspaceId}` : null) : a.workspaceId ? `herdr:${a.session}:${a.workspaceId}` : null
  return {
    id: `${app ? 'herdr-app' : 'herdr'}:${a.session}:${a.paneId}`,
    name: a.name || a.codename || a.tabTitle || path.basename(a.cwd) || a.paneId,
    codename: a.codename || null,
    colour: a.colour || null,
    state: mapState(a.status),
    host: app ? 'herdr-app' : 'herdr',
    terminalApp: app ? 'herdr-app' : a.cmuxWorkspaceId ? 'cmux' : null,
    scope,
    space: a.display || a.session,
    isMain: isMainFor(claims, scope, a.paneId),
    cwd: a.cwd,
    branch: a.branch || null,
    lastLine: a.title || null,
    cli: cliOf(a.agent),
    canSend: true
  }
}

/** Live surface ids and refs per cmux workspace ref; a workspace missing here has no checkable claim. */
export type CmuxSurfaces = Record<string, string[]>

/** A cmux id carries the claimed surface when it is live, so sends and relay keys reach that surface; otherwise the workspace's focused one. */
function fromTab(t: CmuxTab, host: 'cmux' | 'tmux', claims: Claims, surfaces: CmuxSurfaces): Agent {
  const scope = host === 'cmux' && t.id ? `cmux:${t.id}` : null
  const claimed = scope ? claims[claimKey(scope)]?.surface ?? '' : ''
  const isMain = !!claimed && (surfaces[t.ref] || []).includes(claimed)
  return {
    id: host === 'tmux' ? `tmux:${t.ref}:${t.ref}` : isMain ? `cmux:${t.ref}:${claimed}` : `cmux:${t.ref}`,
    name: t.title || path.basename(t.cwd) || t.ref,
    codename: null,
    colour: null,
    state: 'unknown',
    host,
    terminalApp: host,
    scope,
    space: host === 'cmux' ? 'cmux' : 'tmux',
    isMain,
    cwd: t.cwd,
    branch: null,
    lastLine: null,
    cli: null,
    canSend: true
  }
}

function fromProcess(p: AgentProcess): Agent {
  return {
    id: `bare:${p.pid}:${p.pid}`,
    name: path.basename(p.cwd) || p.cmd,
    codename: null,
    colour: null,
    state: 'unknown',
    host: 'bare',
    terminalApp: null,
    scope: null,
    space: BARE_SPACE,
    isMain: false,
    cwd: p.cwd,
    branch: null,
    lastLine: null,
    cli: p.cmd || null,
    canSend: false
  }
}

/** Mains first, then by space so groups stay contiguous, then by name. */
export function sortAgents(agents: Agent[]): Agent[] {
  return [...agents].sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.space.localeCompare(b.space) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

/** Bare processes already exclude herdr-owned pids (agentProcesses); cmux tabs hosting a herdr session are dropped as duplicates. */
export function toAgents(snap: HerdrSnapshot, tabs: CmuxTab[], procs: AgentProcess[], claims: Claims, tabHost: 'cmux' | 'tmux' = 'cmux', surfaces: CmuxSurfaces = {}): Agent[] {
  const herdrWorkspaces = new Set(snap.agents.map((a) => a.cmuxWorkspaceId).filter(Boolean))
  return sortAgents([
    ...snap.agents.map((a) => fromHerdr(a, claims)),
    ...tabs.filter((t) => !t.id || !herdrWorkspaces.has(t.id)).map((t) => fromTab(t, tabHost, claims, surfaces)),
    ...procs.map(fromProcess)
  ])
}
