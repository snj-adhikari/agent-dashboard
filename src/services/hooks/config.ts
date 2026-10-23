import fs from 'fs'
import path from 'path'
import { settings } from '../settings'
import { hookIntervals } from './state'
import type { AtlassianSettings, ProfileSettings, Settings } from '../settings'

export const POLL_INTERVAL_MIN = 30
const MIN_INTERVAL_MIN = 5
const MAX_INTERVAL_MIN = 24 * 60

export function validInterval(minutes: unknown): minutes is number {
  return Number.isInteger(minutes) && (minutes as number) >= MIN_INTERVAL_MIN && (minutes as number) <= MAX_INTERVAL_MIN
}

export function pollIntervalMin(hook: string): number {
  return hookIntervals()[hook] ?? POLL_INTERVAL_MIN
}

/** Each poll looks a little past its own interval so nothing falls between two polls. */
export function lookbackMin(hook: string): number {
  return pollIntervalMin(hook) + 5
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

const CONFIG_PATH = path.join(__dirname, '..', '..', '..', 'hooks.config.json')

const DEFAULTS: HooksConfig = {
  pollModel: 'claude-sonnet-5',
  completion: 'approve',
  maxConcurrent: 1,
  gate: { fiveHourPct: 50, sevenDayPct: 95 },
  jiraProjects: [],
  projectRepos: {},
  repositoryField: {},
  repoDescriptions: {},
  baseBranches: [],
  allowedGithubOrgs: []
}

let testOverride: Partial<Settings> | null = null

/** Tests swap in settings here instead of touching the shared settings cache. */
export function overrideHookSettings(next: Partial<Settings> | null): void {
  testOverride = next
}

export function hookSettings(): Partial<Settings> {
  return testOverride || settings()
}

export function atlassianSettings(): AtlassianSettings {
  return { siteUrl: '', repositoryFieldId: '', workIssueTypes: ['Bug'], subtaskIssueType: '', extraInstructions: '', ...hookSettings().atlassian }
}

export function profileSettings(): ProfileSettings {
  return { displayName: '', githubHandle: '', createPrSkill: '', prReviewSkill: '', ...hookSettings().profile }
}

export function loadConfig(): HooksConfig {
  const fromSettings = hookSettings().hooks
  if (fromSettings) return { ...DEFAULTS, ...fromSettings }
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }
  } catch {
    return DEFAULTS
  }
}
