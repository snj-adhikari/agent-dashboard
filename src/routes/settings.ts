import type { IncomingMessage, ServerResponse } from 'http'
import { readJsonBody, sendJson } from '../http'
import { loadSettings, saveSettings, settings, SETUP_STEPS, type Settings } from '../services/settings'

const KEYS: (keyof Settings)[] = ['repoDirs', 'vaultPath', 'usageStatePath', 'profile', 'atlassian', 'hooks', 'service', 'blocker', 'terminal', 'terminalOpenWindow', 'completedSteps', 'onboardedAt']

function validate(patch: Partial<Settings>): string | null {
  const site = patch.atlassian?.siteUrl
  if (site && !/^https:\/\/[a-z0-9-]+\.atlassian\.net\/?$/i.test(site)) return 'Atlassian site must look like https://<site>.atlassian.net'
  if (patch.onboardedAt !== undefined && !(typeof patch.onboardedAt === 'string' && !Number.isNaN(Date.parse(patch.onboardedAt)))) return 'onboardedAt must be an ISO date'
  const steps = patch.completedSteps
  if (steps && !(Array.isArray(steps) && steps.every((s) => (SETUP_STEPS as readonly string[]).includes(s)))) return 'Unknown setup step'
  if (patch.repoDirs && !(Array.isArray(patch.repoDirs) && patch.repoDirs.every((d) => typeof d === 'string'))) return 'repoDirs must be a list of paths'
  if (patch.terminal !== undefined && !['auto', 'cmux', 'tmux', 'terminal'].includes(patch.terminal)) return 'Unknown terminal backend'
  if (patch.terminalOpenWindow !== undefined && typeof patch.terminalOpenWindow !== 'boolean') return 'terminalOpenWindow must be true or false'
  return null
}

export function redactSettings(s: Partial<Settings>): Partial<Settings> {
  if (!s.atlassian) return s
  return { ...s, atlassian: { ...s.atlassian, apiToken: '', apiTokenSet: Boolean(s.atlassian.apiToken) } as Settings['atlassian'] }
}

export function keepStoredToken(patch: Partial<Settings>, stored: Partial<Settings>): Partial<Settings> {
  if (!patch.atlassian || patch.atlassian.apiToken) return patch
  return { ...patch, atlassian: { ...patch.atlassian, apiToken: stored.atlassian?.apiToken ?? '' } }
}

export function handleGetSettings(res: ServerResponse): void {
  sendJson(res, { ok: true, settings: redactSettings(settings()) })
}

export async function handleSaveSettings(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readJsonBody(req)
    const patch: Partial<Settings> = {}
    for (const key of KEYS) if (key in body) Object.assign(patch, { [key]: body[key] })
    const error = validate(patch)
    if (error) return sendJson(res, { ok: false, error })
    await saveSettings(keepStoredToken(patch, settings()))
    sendJson(res, { ok: true, settings: redactSettings(await loadSettings()) })
  } catch (e) {
    sendJson(res, { ok: false, error: (e as Error).message })
  }
}
