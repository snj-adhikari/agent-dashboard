import { getDb } from './db'
import type { HooksConfig } from './hooks/config'

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

export const SETUP_STEPS = ['mongo', 'repos', 'profile', 'vault', 'atlassian', 'service', 'blocker'] as const
export type SetupStep = (typeof SETUP_STEPS)[number]

const COLLECTION = 'settings'
const DOC_ID = 'default'

let cache: Partial<Settings> = {}
let loaded = false

/** Sync callers read this cache; it is filled at startup and after every save. */
export function settings(): Partial<Settings> {
  return cache
}

export function settingsLoaded(): boolean {
  return loaded
}

export async function loadSettings(): Promise<Partial<Settings>> {
  const db = await getDb()
  const doc = await db.collection<{ _id: string } & Partial<Settings>>(COLLECTION).findOne({ _id: DOC_ID })
  if (doc) {
    const { _id, ...rest } = doc
    cache = rest
  }
  loaded = true
  return cache
}

export async function saveSettings(patch: Partial<Settings>): Promise<Partial<Settings>> {
  const db = await getDb()
  await db.collection<{ _id: string }>(COLLECTION).updateOne({ _id: DOC_ID }, { $set: patch }, { upsert: true })
  return loadSettings()
}
