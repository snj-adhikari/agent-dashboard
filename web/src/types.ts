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

export interface MonitorState {
  repos: Repo[]
  tabs: CmuxTab[]
  agents: AgentProcess[]
}

export interface GraphResponse {
  mermaid: string
  state: MonitorState
  ts: string
}

export interface Snapshot {
  ts: string
  repoCount: number
  worktreeCount: number
  tabs: { ref: string; cwd: string; title: string; sessionId?: string }[]
  agents: { pid: string; cmd: string; cwd: string; sessionId?: string }[]
}

export interface SessionSummary {
  ref: string
  cwd: string
  title: string
  sessionId?: string
  branches: string[]
  firstSeen: string
  lastSeen: string
}

export interface TimelinePoint {
  ts: string
  tabs: number
  agents: number
  worktrees: number
}

export type HistoryResponse = { ok: true; timeline: TimelinePoint[]; sessions: SessionSummary[] } | { ok: false; error?: string; mongoDown?: boolean }

export interface HookStart {
  id: string
  title: string
  ref: string
  branch?: string
  url?: string
  at: string
}

export interface HookStatus {
  name: string
  lastPollAt: string | null
  lastEvent: string | null
  usageGateOk: boolean
  gateReason: string | null
  lastError: string | null
  flags: string[]
  enabled: boolean
  autoPaused: { reason: 'idle' | 'queue'; until: number } | null
  intervalMin: number
  recent: HookStart[]
}

export interface QueueItem {
  hook: string
  id: string
  title: string
  urgent: boolean
  priority: string
  type: string
  repo: string
  branch: string
  url?: string
  queuedAt: string
}

export interface HookSession {
  sessionId: string
  hook: string
  ticket: string
  branch: string
  phase: string
  at: string
}

export interface HookStatusResponse {
  ok: boolean
  hooks: HookStatus[]
  queue: QueueItem[]
  sessions: HookSession[]
  maxConcurrent: number
}

export interface BaseBranchRule {
  repo: string
  titleMatch?: string
  base: string
}

export interface GateLimits {
  fiveHourPct: number
  sevenDayPct: number
}

export interface HooksConfig {
  pollModel: string
  completion: 'approve' | 'draft-pr'
  maxConcurrent: number
  gate: GateLimits
  jiraProjects: string[]
  projectRepos: Record<string, string>
  repositoryField: Record<string, string>
  repoDescriptions: Record<string, string>
  baseBranches: BaseBranchRule[]
  allowedGithubOrgs: string[]
}

export interface ProfileSettings {
  displayName: string
  githubHandle: string
  createPrSkill: string
  prReviewSkill: string
}

export interface AtlassianSettings {
  siteUrl: string
  repositoryFieldId: string
  workIssueTypes: string[]
  subtaskIssueType: string
  extraInstructions: string
}

export interface ServiceSettings {
  label: string
  nodePath: string
  repoPath: string
  logPath: string
  errLogPath: string
  pathEnv: string
  secretEnvNames: string[]
}

export interface BlockerSettings {
  name: string
  sites: string[]
}

export type SetupStep = 'mongo' | 'repos' | 'profile' | 'vault' | 'atlassian' | 'service' | 'blocker'

export interface Settings {
  terminal: 'auto' | 'cmux' | 'tmux' | 'terminal'
  terminalOpenWindow: boolean
  repoDirs: string[]
  vaultPath: string
  usageStatePath: string
  profile: ProfileSettings
  atlassian: AtlassianSettings
  hooks: HooksConfig
  service: ServiceSettings
  blocker: BlockerSettings
  completedSteps: SetupStep[]
  onboardedAt?: string
}

export interface SetupStatus {
  mongo: { up: boolean; error?: string }
  missing: SetupStep[]
  onboarded: boolean
  serviceDefaults: ServiceSettings
  terminal: { backend: 'cmux' | 'tmux' | 'terminal'; canSend: boolean; canRead: boolean }
}
