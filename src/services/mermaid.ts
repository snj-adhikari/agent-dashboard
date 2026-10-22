import path from 'path'
import { activeCwds as activeCwdsOf, isActiveWorktree, sanitize } from '../utils'
import type { MonitorState } from '../types'

export function buildMermaid(state: MonitorState, expandedRepoIds: Set<string> = new Set()): string {
  const nodes: string[] = []
  const edges: string[] = []
  const clicks: string[] = []

  const activeCwds = activeCwdsOf(state)

  function repoScore(repo: MonitorState['repos'][number]): number {
    if (repo.worktrees.some((wt) => isActiveWorktree(wt.path, activeCwds))) return 2
    if (repo.worktrees.some((wt) => !wt.isMain)) return 1
    return 0
  }

  const sortedRepos = [...state.repos].sort((a, b) => repoScore(b) - repoScore(a))

  function wtLabel(wt: MonitorState['repos'][number]['worktrees'][number]): string {
    return `\u{1F33F} ${wt.branch || 'detached'}\\n\u{1F4C1} ${path.basename(wt.path)}`
  }

  for (const repo of sortedRepos) {
    const repoId = `repo_${sanitize(repo.name)}`
    nodes.push(`${repoId}(("${repo.name}")):::repo`)
    clicks.push(`click ${repoId} call handleRepoClick("${encodeURIComponent(repo.path)}") "New session"`)

    const activeWts = repo.worktrees.filter((wt) => isActiveWorktree(wt.path, activeCwds))
    const inactiveWts = repo.worktrees.filter((wt) => !isActiveWorktree(wt.path, activeCwds))

    for (const wt of activeWts) {
      const wtId = `wt_${sanitize(wt.path)}`
      nodes.push(`${wtId}["${wtLabel(wt)}"]:::worktree`)
      edges.push(`${repoId} --> ${wtId}`)
    }

    if (inactiveWts.length) {
      if (expandedRepoIds.has(repoId)) {
        for (const wt of inactiveWts) {
          const wtId = `wt_${sanitize(wt.path)}`
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

  return `graph LR
classDef repo fill:#334155,color:#f1f5f9,stroke:#64748b,cursor:pointer
classDef worktree fill:#1e40af,color:#dbeafe,stroke:#3b82f6
classDef worktreeDim fill:#1e293b,color:#94a3b8,stroke:#334155
classDef tab fill:#166534,color:#dcfce7,stroke:#22c55e
classDef agent fill:#78350f,color:#fef3c7,stroke:#f59e0b
classDef more fill:#0f172a,color:#64748b,stroke:#334155,stroke-dasharray: 3 3,cursor:pointer
${nodes.join('\n')}
${edges.join('\n')}
${clicks.join('\n')}`
}
