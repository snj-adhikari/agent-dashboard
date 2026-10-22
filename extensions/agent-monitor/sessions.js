const MONITOR_URL = 'http://localhost:5818'

const norm = (p) => p.replace(/\/+$/, '').toLowerCase()
const within = (cwd, root) => norm(cwd) === norm(root) || norm(cwd).startsWith(`${norm(root)}/`)

async function fetchState() {
  const res = await fetch(`${MONITOR_URL}/api/graph`)
  if (!res.ok) throw new Error(`monitor returned ${res.status}`)
  return (await res.json()).state
}

function sessionRows(state) {
  const tabbed = new Set(state.tabs.map((t) => t.sessionId).filter(Boolean))
  const tabs = state.tabs.map((t) => ({ cwd: t.cwd, title: t.title || 'untitled', meta: `${t.ref}${t.lastActive ? ` · ${t.lastActive}` : ''}` }))
  const loose = state.agents
    .filter((a) => !a.sessionId || !tabbed.has(a.sessionId))
    .map((a) => ({ cwd: a.cwd, title: `${a.cmd} pid ${a.pid}`, meta: 'no cmux tab' }))
  return [...tabs, ...loose]
}

function groupByRepo(state) {
  const rows = sessionRows(state)
  const claimed = new Set()
  const repos = []
  for (const repo of state.repos) {
    const worktrees = []
    for (const wt of repo.worktrees) {
      const mine = rows.filter((r, i) => within(r.cwd, wt.path) && claimed.add(i))
      if (mine.length) worktrees.push({ branch: wt.branch || 'detached', isMain: wt.isMain, changed: wt.changedFiles, sessions: mine })
    }
    if (worktrees.length) repos.push({ name: repo.name, idle: repo.worktrees.length - worktrees.length, worktrees })
  }
  const strays = rows.filter((_, i) => !claimed.has(i))
  return { total: rows.length, repos, strays }
}
