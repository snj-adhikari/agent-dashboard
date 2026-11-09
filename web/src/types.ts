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
  label?: string
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

export type SetupStep = 'mongo' | 'repos' | 'profile' | 'vault' | 'atlassian' | 'service' | 'tailscale' | 'blocker'

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

export type LearningGran = 'day' | 'week' | 'month'
export type LearningAudience = 'slack-dm' | 'slack-channel' | 'jira' | 'confluence' | 'github-pr'
export type LearningSource = 'slack' | 'jira' | 'confluence' | 'github' | 'prompts' | 'notes' | 'observed' | 'edits-feedback'
export type LearntKind = 'feature' | 'structure' | 'token' | 'nepali' | 'perspective' | 'feedback-rule' | 'edit-rule'
export type LearningRunKind = 'learn' | 'refresh' | 'other'
export type ProfileStatus = 'active' | 'insufficient' | 'no profile'
export type FolderVia = 'env' | 'vaultPath' | 'cached' | 'default'

export interface LabelCounts { human: number; ai: number; unsure: number }
export interface CaptureCounts { pull: number; observed: number; prompts: number; feedback: number; edits: number }

export interface LearningBucket {
  key: string            // '2026-11-05' | '2026-W45' | '2026-11'
  start: string          // ISO date of bucket start, for sorting/axis
  learnt: LabelCounts
  captures: CaptureCounts
  cumulativeHuman: number
}

export interface LearningRun { date: string; kind: LearningRunKind }

export interface AudienceInsight {
  audience: LearningAudience
  humanSamples: number
  lastUpdated: string | null
  profile: ProfileStatus
  frontmatterSamples: number | null
  topMarkers: string[]   // max 3, feature/structure names only
}

export interface LearningHealth {
  lastRun: string | null
  stale: boolean
  staleDays: number
  lock: 'learn' | 'refresh' | null
  coverageFrom: string | null
  eval: { precision: number | null; recall: number | null }
}

export interface LearningCurrent {
  empty: boolean
  hint: string | null    // '/more-like-you learn' when empty
  totals: LabelCounts & { captures: CaptureCounts }
  learnt: Record<LearntKind, number>
  structureByAudience: Record<LearningAudience, number>
  sources: Record<LearningSource, number>
  audiences: AudienceInsight[]
  health: LearningHealth
  runs: LearningRun[]
}

export type LearningResponse =
  | {
      ok: true
      gran: LearningGran
      current: LearningCurrent
      history: LearningBucket[]
      source: 'mongo' | 'vault'
      mongoDown: boolean
      folder: { via: FolderVia; display: string }
    }
  | { ok: false; error: string }
