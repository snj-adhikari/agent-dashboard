import type { IncomingMessage, ServerResponse } from 'http'
import { readJsonBody, sendJson } from '../http'
import { loadSettings, saveSettings, settings, SETUP_STEPS, type Settings } from '../services/settings'

const KEYS: (keyof Settings)[] = ['repoDirs', 'vaultPath', 'usageStatePath', 'profile', 'atlassian', 'hooks', 'service', 'blocker', 'completedSteps', 'onboardedAt']

function validate(patch: Partial<Settings>): string | null {
  const site = patch.atlassian?.siteUrl
  if (site && !/^https:\/\/[a-z0-9-]+\.atlassian\.net\/?$/i.test(site)) return 'Atlassian site must look like https://<site>.atlassian.net'
  if (patch.onboardedAt !== undefined && !(typeof patch.onboardedAt === 'string' && !Number.isNaN(Date.parse(patch.onboardedAt)))) return 'onboardedAt must be an ISO date'
  const steps = patch.completedSteps
  if (steps && !(Array.isArray(steps) && steps.every((s) => (SETUP_STEPS as readonly string[]).includes(s)))) return 'Unknown setup step'
  if (patch.repoDirs && !(Array.isArray(patch.repoDirs) && patch.repoDirs.every((d) => typeof d === 'string'))) return 'repoDirs must be a list of paths'
  return null
}

export function handleGetSettings(res: ServerResponse): void {
  sendJson(res, { ok: true, settings: settings() })
}

export async function handleSaveSettings(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readJsonBody(req)
    const patch: Partial<Settings> = {}
    for (const key of KEYS) if (key in body) Object.assign(patch, { [key]: body[key] })
    const error = validate(patch)
    if (error) return sendJson(res, { ok: false, error })
    await saveSettings(patch)
    sendJson(res, { ok: true, settings: await loadSettings() })
  } catch (e) {
    sendJson(res, { ok: false, error: (e as Error).message })
  }
}
