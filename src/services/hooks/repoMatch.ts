import fs from 'fs'
import path from 'path'
import { watchDirs } from '../../utils'
import { loadConfig } from './config'

export function repoPathByName(name: string): string | undefined {
  for (const base of watchDirs()) {
    const p = path.join(base, name)
    if (fs.existsSync(path.join(p, '.git'))) return p
  }
  return undefined
}

export function localRepoNames(): string[] {
  const names = new Set<string>()
  for (const base of watchDirs()) {
    if (!fs.existsSync(base)) continue
    for (const name of fs.readdirSync(base)) {
      if (fs.existsSync(path.join(base, name, '.git'))) names.add(name)
    }
  }
  return [...names]
}

function readmeSummary(repoName: string): string {
  const repoPath = repoPathByName(repoName)
  if (!repoPath) return ''
  try {
    const lines = fs.readFileSync(path.join(repoPath, 'README.md'), 'utf8').split('\n')
    const line = lines.map((l) => l.trim()).find((l) => l && !/^[#!<[`|>-]/.test(l)) || ''
    return line.replace(/[[\]()*_`]/g, '').slice(0, 140)
  } catch {
    return ''
  }
}

export function repoCatalogue(): string {
  const { repoDescriptions } = loadConfig()
  return localRepoNames()
    .map((name) => {
      const desc = repoDescriptions[name] || readmeSummary(name)
      return desc ? `${name}: ${desc}` : name
    })
    .join('; ')
}

export interface RepoSignals {
  project: string
  repository?: string
  parentRepository?: string
  repoGuess?: string
}

// Order: ticket Repository field, parent's Repository field, context guess (local repos only), project default.
export function repoForJira(signals: RepoSignals): string | undefined {
  const { repositoryField, projectRepos } = loadConfig()
  const guess = signals.repoGuess && localRepoNames().includes(signals.repoGuess) ? signals.repoGuess : undefined
  const name =
    (signals.repository && repositoryField[signals.repository]) ||
    (signals.parentRepository && repositoryField[signals.parentRepository]) ||
    guess ||
    projectRepos[signals.project]
  return name ? repoPathByName(name) : undefined
}

export function baseBranchFor(repoPath: string, title: string): string {
  const repoName = path.basename(repoPath)
  const rule = loadConfig().baseBranches.find(
    (r) => r.repo === repoName && (!r.titleMatch || title.toLowerCase().includes(r.titleMatch.toLowerCase()))
  )
  return rule ? rule.base : 'origin/HEAD'
}
