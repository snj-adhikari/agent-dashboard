import fs from 'fs'
import path from 'path'
import type { IncomingMessage, ServerResponse } from 'http'
import { readJsonBody, sendJson } from '../http'
import { mongoStatus } from '../services/db'
import { expandHome } from '../utils'
import { saveSettings, settings, SETUP_STEPS, type SetupStep } from '../services/settings'
import { terminalInfo } from '../services/terminal'
import { cleanSecrets, generateLaunchAgent, installLaunchAgent, serviceDefaults } from '../services/launchAgent'

const REQUIRED: SetupStep[] = ['mongo', 'repos', 'profile']

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

function countRepos(dir: string): number {
  return fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, '.git'))).length
}

export function missingSteps(mongoUp: boolean): SetupStep[] {
  const s = settings()
  const done = new Set(s.completedSteps || [])
  const requiredOk: Record<string, boolean> = {
    mongo: mongoUp,
    repos: !!s.repoDirs?.length,
    profile: !!s.profile?.displayName
  }
  return SETUP_STEPS.filter((step) => (REQUIRED.includes(step) ? !requiredOk[step] : !done.has(step)))
}

export async function handleSetupStatus(res: ServerResponse): Promise<void> {
  const mongo = await mongoStatus()
  sendJson(res, { mongo, missing: missingSteps(mongo.up), onboarded: !!settings().onboardedAt || !!settings().completedSteps?.length, serviceDefaults: serviceDefaults(), terminal: terminalInfo() })
}

export async function handleCheckDir(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req)
  const dir = typeof body.path === 'string' ? expandHome(body.path.trim()) : ''
  if (!dir || !isDir(dir)) return sendJson(res, { ok: false, exists: false, repoCount: 0 })
  sendJson(res, { ok: true, exists: true, repoCount: countRepos(dir) })
}

async function rememberSecretNames(names: string[]): Promise<void> {
  const service = settings().service
  if (service && names.some((n) => !service.secretEnvNames?.includes(n))) await saveSettings({ service: { ...service, secretEnvNames: names } })
}

export async function handleServiceGenerate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readJsonBody(req)
    const service = (body.service as object | undefined) || settings().service || {}
    const result = await generateLaunchAgent(service, body.secrets)
    await rememberSecretNames(result.secretEnvNames)
    sendJson(res, { ok: true, ...result })
  } catch (e) {
    sendJson(res, { ok: false, error: (e as Error).message })
  }
}

export async function handleServiceInstall(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readJsonBody(req)
    const label = (typeof body.label === 'string' && body.label) || settings().service?.label || ''
    const secrets = cleanSecrets(body.secrets)
    if (Object.keys(secrets).length) await rememberSecretNames((await generateLaunchAgent(settings().service || {}, secrets)).secretEnvNames)
    await installLaunchAgent(label)
    sendJson(res, { ok: true })
  } catch (e) {
    sendJson(res, { ok: false, error: (e as Error).message })
  }
}
