export interface Worktree {
  path: string
  isMain: boolean
  branch: string
  changedFiles: number
}
export interface Repo {
  name: string
  worktrees: Worktree[]
}
export interface Tab {
  ref: string
  cwd: string
  title: string
  lastActive: string | null
  sessionId?: string
}
export interface Agent {
  pid: string
  cmd: string
  cwd: string
  sessionId?: string
}
export interface MonitorState {
  repos: Repo[]
  tabs: Tab[]
  agents: Agent[]
}

interface Row {
  label: string
  sessions: string[]
}

const norm = (p: string) => p.replace(/\/+$/, '').toLowerCase()
const within = (cwd: string, root: string) => norm(cwd) === norm(root) || norm(cwd).startsWith(`${norm(root)}/`)
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function sessionLines(state: MonitorState): { cwd: string; line: string }[] {
  const tabbed = new Set(state.tabs.map((t) => t.sessionId).filter(Boolean))
  const tabs = state.tabs.map((t) => ({ cwd: t.cwd, line: `${t.ref}  ${short(t.title || 'untitled', 48)}  ${t.lastActive ?? ''}`.trimEnd() }))
  const loose = state.agents
    .filter((a) => !a.sessionId || !tabbed.has(a.sessionId))
    .map((a) => ({ cwd: a.cwd, line: `${a.cmd} pid ${a.pid}  (no cmux tab)` }))
  return [...tabs, ...loose]
}

/** Repos and worktrees that have at least one Claude session, drawn as a tree. */
export function formatSessions(state: MonitorState): string {
  const sessions = sessionLines(state)
  const claimed = new Set<number>()
  const out: string[] = []

  for (const repo of state.repos) {
    const rows: Row[] = []
    for (const wt of repo.worktrees) {
      const mine = sessions.flatMap((s, i) => (within(s.cwd, wt.path) ? [i] : []))
      mine.forEach((i) => claimed.add(i))
      if (!mine.length) continue
      const dirty = wt.changedFiles ? ` · ${wt.changedFiles} changed` : ''
      rows.push({ label: `${wt.branch || 'detached'}${wt.isMain ? ' (main checkout)' : ''}${dirty}`, sessions: mine.map((i) => sessions[i].line) })
    }
    if (!rows.length) continue
    const idle = repo.worktrees.length - rows.length
    out.push(`${repo.name}  (${rows.length} active${idle > 0 ? `, ${idle} idle` : ''})`)
    rows.forEach((r, ri) => {
      const last = ri === rows.length - 1
      out.push(`${last ? '└─' : '├─'} ${r.label}`)
      r.sessions.forEach((s) => out.push(`${last ? '   ' : '│  '} ● ${s}`))
    })
    out.push('')
  }

  const other = sessions.filter((_, i) => !claimed.has(i))
  if (other.length) {
    out.push('Not in a known worktree')
    other.forEach((s) => out.push(`   ● ${s.line}  ${s.cwd}`))
    out.push('')
  }
  if (!out.length) return 'No Claude sessions found.'
  return `${sessions.length} Claude session(s)\n\n${out.join('\n').trimEnd()}`
}
