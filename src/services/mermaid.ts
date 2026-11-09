import path from 'path'
import { activeCwds as activeCwdsOf, isActiveWorktree, sanitize } from '../utils'
import type { MonitorState } from '../types'

/** The graph renders with securityLevel loose (click callbacks), so label text must not carry markup. */
const PERMANENT_SESSIONS = ['drive-pr-review', 'drive-generic']

export function mermaidText(s: string): string {
  return s.replace(/["\\]/g, '').replace(/&/g, '#amp;').replace(/</g, '#lt;').replace(/>/g, '#gt;').replace(/[\r\n]+/g, ' ')
}

export function buildMermaid(state: MonitorState, expandedRepoIds: Set<string> = new Set()): string {
  const nodes: string[] = []
  const edges: string[] = []
  const clicks: string[] = []

  const activeCwds = activeCwdsOf(state)
  const renderedWorktrees = new Set<string>()

  function repoScore(repo: MonitorState['repos'][number]): number {
    if (repo.worktrees.some((wt) => isActiveWorktree(wt.path, activeCwds))) return 2
    if (repo.worktrees.some((wt) => !wt.isMain)) return 1
    return 0
  }

  const sortedRepos = [...state.repos].sort((a, b) => repoScore(b) - repoScore(a))

  function wtLabel(wt: MonitorState['repos'][number]['worktrees'][number]): string {
    return `\u{1F33F} ${wt.branch || 'detached'}\\n\u{1F4C1} ${path.basename(wt.path)}`
  }

  let lastRepoId = ''
  for (const repo of sortedRepos) {
    const repoId = `repo_${sanitize(repo.name)}`
    lastRepoId = repoId
    nodes.push(`${repoId}(("${repo.name}")):::repo`)
    clicks.push(`click ${repoId} call handleRepoClick("${encodeURIComponent(repo.path)}") "New session"`)

    const activeWts = repo.worktrees.filter((wt) => isActiveWorktree(wt.path, activeCwds))
    const inactiveWts = repo.worktrees.filter((wt) => !isActiveWorktree(wt.path, activeCwds))

    for (const wt of activeWts) {
      const wtId = `wt_${sanitize(wt.path)}`
      renderedWorktrees.add(wtId)
      nodes.push(`${wtId}["${wtLabel(wt)}"]:::worktree`)
      edges.push(`${repoId} --> ${wtId}`)
    }

    if (inactiveWts.length) {
      if (expandedRepoIds.has(repoId)) {
        for (const wt of inactiveWts) {
          const wtId = `wt_${sanitize(wt.path)}`
          renderedWorktrees.add(wtId)
          nodes.push(`${wtId}["${wtLabel(wt)}"]:::worktreeDim`)
          edges.push(`${repoId} -.-> ${wtId}`)
        }
      } else {
        const moreId = `${repoId}_more`
        nodes.push(`${moreId}(["+${inactiveWts.length} inactive"]):::more`)
        edges.push(`${repoId} -.-> ${moreId}`)
        clicks.push(`click ${moreId} call handleExpandRepo("${repoId}") "Show inactive worktrees"`)
      }
    }
  }

  for (const ws of state.tabs) {
    if (!ws.cwd) continue
    const wtId = `wt_${sanitize(ws.cwd)}`
    const tabId = `tab_${sanitize(ws.cwd)}`
    const safeTitle = ws.title.replace(/["\\]/g, '')
    nodes.push(`${tabId}["\u{1F5A5} ${safeTitle}"]:::tab`)
    edges.push(`${wtId} -.-> ${tabId}`)
  }

  for (const a of state.agents) {
    const wtId = `wt_${sanitize(a.cwd)}`
    const agentId = `agent_${a.pid}`
    nodes.push(`${agentId}(["\u26A1 ${a.cmd} (pid ${a.pid})"]):::agent`)
    edges.push(`${wtId} -.-> ${agentId}`)
  }

  const styles: string[] = []
  const bySession = new Map<string, MonitorState['herdr']>()
  for (const a of state.herdr) bySession.set(a.session, [...(bySession.get(a.session) || []), a])
  const permanentLast = (s: string): number => (PERMANENT_SESSIONS.includes(s) ? 1 : 0)
  for (const [session, agents] of [...bySession].sort(([a], [b]) => permanentLast(a) - permanentLast(b))) {
    let linked = false
    nodes.push(`subgraph herdr_${sanitize(session)}["${mermaidText(agents[0].display || session)}"]`)
    for (const a of agents) {
      const id = `herdr_${sanitize(session)}_${sanitize(a.paneId)}`
      nodes.push(`${id}(["${mermaidText([a.codename || a.label, a.ticket || a.tabTitle || a.paneId, a.status].filter(Boolean).join(' · '))}"]):::herdr`)
      if (a.colour && /^#[0-9a-fA-F]{6}$/.test(a.colour)) styles.push(`style ${id} stroke:${a.colour},stroke-width:3px`)
      const wtId = a.worktree && `wt_${sanitize(a.worktree)}`
      if (wtId && renderedWorktrees.has(wtId)) {
        edges.push(`${wtId} -.-> ${id}`)
        linked = true
      }
    }
    nodes.push('end')
    if (!linked && lastRepoId) edges.push(`${lastRepoId} ~~~ herdr_${sanitize(session)}`)
  }

  return `graph LR
classDef repo fill:#334155,color:#f1f5f9,stroke:#64748b,cursor:pointer
classDef worktree fill:#1e40af,color:#dbeafe,stroke:#3b82f6
classDef worktreeDim fill:#1e293b,color:#94a3b8,stroke:#334155
classDef tab fill:#166534,color:#dcfce7,stroke:#22c55e
classDef agent fill:#78350f,color:#fef3c7,stroke:#f59e0b
classDef herdr fill:#3b0764,color:#f3e8ff,stroke:#a855f7
classDef more fill:#0f172a,color:#64748b,stroke:#334155,stroke-dasharray: 3 3,cursor:pointer
${nodes.join('\n')}
${edges.join('\n')}
${clicks.join('\n')}
${styles.join('\n')}`
}
