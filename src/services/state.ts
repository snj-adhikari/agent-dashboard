import { findRepos } from './repos'
import { cmuxWorkspaces } from './cmux'
import { agentProcesses } from './processes'
import { activeCwds } from '../utils'
import type { MonitorState } from '../types'

const STATE_TTL_MS = 3000
let inflight: Promise<MonitorState> | null = null
let cached: { at: number; state: MonitorState } | null = null

async function buildState(): Promise<MonitorState> {
  const tabs = cmuxWorkspaces()
  const agents = agentProcesses()
  return { repos: await findRepos(activeCwds({ tabs, agents })), tabs, agents }
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
  return activeCwds({ tabs: cmuxWorkspaces(), agents: agentProcesses() })
}
