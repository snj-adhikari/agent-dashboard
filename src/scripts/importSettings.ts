import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { loadSettings, saveSettings, SETUP_STEPS } from '../services/settings'
import type { Settings, SetupStep } from '../services/settings'

const FLAGS = [
  'repo-dirs', 'vault', 'plist', 'blocker-sites', 'blocker-name', 'display-name', 'github', 'create-pr-skill',
  'pr-review-skill', 'atlassian-site', 'repository-field', 'work-types', 'subtask-type', 'extra-instructions-file',
  'usage-state', 'hooks-config'
]
const BOOLEAN_FLAGS = ['dry-run', 'force']
const REPO_ROOT = path.join(__dirname, '..', '..')

type Plain = Record<string, unknown>

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].replace(/^--/, '')
    if (BOOLEAN_FLAGS.includes(name)) out[name] = true
    else if (FLAGS.includes(name) && i + 1 < argv.length) out[name] = argv[++i]
    else throw new Error(`Unknown or incomplete flag: ${argv[i]}`)
  }
  return out
}

const expand = (p: string): string => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p)
const list = (s: string): string[] => s.split(',').map((x) => x.trim()).filter(Boolean)

function readPlist(file: string): Plain {
  return JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', expand(file)], { encoding: 'utf8' }))
}

function servicePatch(file: string): Settings['service'] {
  const plist = readPlist(file)
  const args = (plist.ProgramArguments as string[]) || []
  const env = (plist.EnvironmentVariables as Record<string, string>) || {}
  return {
    label: String(plist.Label || ''),
    nodePath: args[0] || '',
    repoPath: String(plist.WorkingDirectory || ''),
    logPath: String(plist.StandardOutPath || ''),
    errLogPath: String(plist.StandardErrorPath || ''),
    pathEnv: env.PATH || '',
    secretEnvNames: Object.keys(env).filter((k) => k !== 'PATH')
  }
}

function buildSeed(a: Record<string, string | boolean>): { seed: Partial<Settings>; steps: SetupStep[] } {
  const str = (k: string): string | undefined => (typeof a[k] === 'string' ? (a[k] as string) : undefined)
  const seed: Partial<Settings> = {}
  const steps: SetupStep[] = []
  const done = (s: SetupStep): number => steps.push(s)

  if (str('repo-dirs')) (seed.repoDirs = list(str('repo-dirs')!).map(expand), done('repos'))
  if (str('vault')) (seed.vaultPath = expand(str('vault')!), done('vault'))
  if (str('usage-state')) seed.usageStatePath = expand(str('usage-state')!)
  if (str('plist')) (seed.service = servicePatch(str('plist')!), done('service'))
  if (str('blocker-sites') || str('blocker-name')) {
    seed.blocker = { name: str('blocker-name') || '', sites: list(str('blocker-sites') || '') }
    done('blocker')
  }
  if (str('display-name') || str('github') || str('create-pr-skill') || str('pr-review-skill')) {
    seed.profile = {
      displayName: str('display-name') || '',
      githubHandle: str('github') || '',
      createPrSkill: str('create-pr-skill') || '',
      prReviewSkill: str('pr-review-skill') || ''
    }
    done('profile')
  }
  const extraFile = str('extra-instructions-file')
  if (str('atlassian-site') || str('repository-field') || str('work-types') || str('subtask-type') || extraFile) {
    seed.atlassian = {
      siteUrl: str('atlassian-site') || '',
      repositoryFieldId: str('repository-field') || '',
      workIssueTypes: list(str('work-types') || ''),
      subtaskIssueType: str('subtask-type') || '',
      extraInstructions: extraFile ? fs.readFileSync(expand(extraFile), 'utf8').trim() : ''
    }
    done('atlassian')
  }
  const hooksPath = expand(str('hooks-config') || path.join(REPO_ROOT, 'hooks.config.json'))
  if (fs.existsSync(hooksPath)) seed.hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'))
  return { seed, steps }
}

const isObject = (v: unknown): v is Plain => !!v && typeof v === 'object' && !Array.isArray(v)
const isEmpty = (v: unknown): boolean => v === undefined || v === '' || (Array.isArray(v) && v.length === 0)

function merge(existing: unknown, seed: unknown, force: boolean): unknown {
  if (isObject(existing) && isObject(seed)) {
    const out: Plain = { ...existing }
    for (const k of Object.keys(seed)) out[k] = merge(existing[k], seed[k], force)
    return out
  }
  return force || isEmpty(existing) ? seed : existing
}

function diff(before: Plain, after: Plain, prefix = ''): string[] {
  const lines: string[] = []
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const key = prefix + k
    if (isObject(before[k]) && isObject(after[k])) lines.push(...diff(before[k] as Plain, after[k] as Plain, key + '.'))
    else if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      lines.push(`~ ${key}: ${JSON.stringify(before[k]) ?? '(unset)'} -> ${JSON.stringify(after[k])}`)
    }
  }
  return lines
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const { seed, steps } = buildSeed(args)
  let existing: Partial<Settings> = {}
  try {
    existing = await loadSettings()
  } catch (e) {
    if (!args['dry-run']) throw e
    console.error(`MongoDB unreachable, diffing against empty settings: ${(e as Error).message}`)
  }
  const force = args.force === true
  const merged = merge(existing, seed, force) as Partial<Settings>
  const completed = new Set<SetupStep>([...(existing.completedSteps || []), ...steps])
  merged.completedSteps = SETUP_STEPS.filter((s) => completed.has(s))

  console.error(diff(existing as Plain, merged as Plain).join('\n') || 'No changes')
  console.log(JSON.stringify(merged, null, 2))
  if (args['dry-run']) return
  await saveSettings(merged)
  console.error('Saved')
}

main().then(() => process.exit(0), (e) => (console.error(e.message), process.exit(1)))
