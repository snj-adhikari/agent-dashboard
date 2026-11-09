export interface PullRequest {
  number: number
  url: string
  state: string
}

export interface Worktree {
  path: string
  branch?: string
  isMain?: boolean
  changedFiles?: number
  pr?: PullRequest
}

export interface Repo {
  path: string
  name: string
  worktrees: Worktree[]
}

export interface CmuxTab {
  ref: string
  id?: string
  cwd: string
  title: string
  lastActive: string | null
  sessionId?: string
}

export interface AgentProcess {
  pid: string
  cmd: string
  cwd: string
  sessionId?: string
}

export interface HerdrAgent {
  session: string
  display?: string
  paneId: string
  workspaceId: string
  tabId: string
  tabTitle?: string
  agent: string
  status: string
  title: string
  cwd: string
  name?: string
  codename?: string
  colour?: string
  ticket?: string
  worktree?: string
  branch?: string
  changedFiles?: number
  cmuxWorkspaceId?: string
}

export interface MonitorState {
  repos: Repo[]
  tabs: CmuxTab[]
  agents: AgentProcess[]
  herdr: HerdrAgent[]
}
