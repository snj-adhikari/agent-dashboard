import { findRepos } from './repos'
import { terminalTabs } from './terminal'
import { agentProcesses, herdrProcessCwds } from './processes'
import { herdrAgents, herdrSideEffects, refreshHerdr, withWorktrees } from './herdr'
import { clientRecentlySeen } from './history'
import { activeCwds } from '../utils'
import type { MonitorState } from '../types'

const STATE_TTL_MS = 3000
const HERDR_SYNC_MS = 15_000
let inflight: Promise<MonitorState> | null = null
let cached: { at: number; state: MonitorState } | null = null

async function buildState(): Promise<MonitorState> {
  const tabs = terminalTabs()
  const agents = agentProcesses()
  const { agents: herdr } = await refreshHerdr()
  const repos = await findRepos(activeCwds({ tabs, agents, herdr: [...herdr, ...herdrProcessCwds()] }))
  return { repos, tabs, agents, herdr: withWorktrees(herdr, repos) }
}

// A build takes seconds, so concurrent 5s polls share one build instead of piling up
export function collectState(): Promise<MonitorState> {
  if (cached && Date.now() - cached.at < STATE_TTL_MS) return Promise.resolve(cached.state)
  inflight ??= buildState()
    .then((state) => {
      cached = { at: Date.now(), state }
      return state
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

export function currentActiveCwds(): Set<string> {
  return activeCwds({ tabs: terminalTabs(), agents: agentProcesses(), herdr: [...herdrAgents(), ...herdrProcessCwds()] })
}

/** The full state (git status per worktree) is only rebuilt while a herdr session runs and the dashboard is open. */
export function startHerdrSync(): void {
  setInterval(async () => {
    try {
      const snap = await refreshHerdr()
      if (!snap.ok) return
      const full = snap.sessions.length && clientRecentlySeen()
      herdrSideEffects(full ? (await collectState()).herdr : withWorktrees(snap.agents, []), snap.sessions)
    } catch {}
  }, HERDR_SYNC_MS)
}
