import fs from 'fs'
import os from 'os'
import path from 'path'
import type { Holding, SideId, SideSettings } from '../agents'
import { CuckooError } from '../relayLog'
import { PERSONAL_IDS, SIDE_IDS, isSideId } from './registry'

export const cuckooDir = (): string => process.env.CUCKOO_SIDE_DIR || path.join(os.homedir(), '.config', 'agent-monitor', 'cuckoo')
export const settingsPath = (): string => path.join(cuckooDir(), 'side.json')

/** Creates `dir` 0700 and refuses a symlink or non-directory in its place. */
export function secureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const st = fs.lstatSync(dir)
  if (st.isSymbolicLink() || !st.isDirectory()) throw new CuckooError('host_failed', `${dir} is not a plain folder`)
  fs.chmodSync(dir, 0o700)
  return dir
}

export function defaultSettings(): SideSettings {
  const enabled = Object.fromEntries(SIDE_IDS.map((id) => [id, !PERSONAL_IDS.includes(id)])) as Record<SideId, boolean>
  return { enabled, holdings: [], currency: 'AUD', hideProjects: false, phonePush: false }
}

const SYMBOL_RE = /^[A-Za-z0-9]{1,12}$/
const CURRENCY_RE = /^[A-Z]{3}$/
const MAX_HOLDINGS = 50

const bad = (msg: string): never => {
  throw new CuckooError('bad_request', msg)
}

/** Validates a partial update; unknown keys are rejected so a typo never silently enables nothing. */
export function mergeSettings(base: SideSettings, patch: Record<string, unknown>): SideSettings {
  const next: SideSettings = { ...base, enabled: { ...base.enabled }, holdings: [...base.holdings] }
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'enabled') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) bad('enabled must be an object')
      for (const [id, on] of Object.entries(value as Record<string, unknown>)) {
        if (!isSideId(id) || typeof on !== 'boolean') bad(`bad enabled.${id}`)
        next.enabled[id as SideId] = on as boolean
      }
    } else if (key === 'holdings') {
      if (!Array.isArray(value) || value.length > MAX_HOLDINGS) bad(`holdings must be an array of at most ${MAX_HOLDINGS}`)
      next.holdings = (value as unknown[]).map((h): Holding => {
        const { symbol, amount } = (h ?? {}) as Record<string, unknown>
        if (typeof symbol !== 'string' || !SYMBOL_RE.test(symbol) || typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) bad('bad holding')
        return { symbol: (symbol as string).toUpperCase(), amount: amount as number }
      })
    } else if (key === 'currency') {
      if (typeof value !== 'string' || !CURRENCY_RE.test(value)) bad('currency must be a 3-letter code')
      next.currency = value as string
    } else if (key === 'hideProjects' || key === 'phonePush') {
      if (typeof value !== 'boolean') bad(`${key} must be a boolean`)
      next[key] = value as boolean
    } else bad(`unknown setting ${key}`)
  }
  return next
}

/** A missing, symlinked or corrupt file falls back to defaults; any stored value that no longer validates is dropped. */
export function readSettings(file = settingsPath()): SideSettings {
  const base = defaultSettings()
  let raw: Record<string, unknown>
  try {
    if (!fs.lstatSync(file).isFile()) return base
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
    try {
      raw = JSON.parse(fs.readFileSync(fd, 'utf8')) as Record<string, unknown>
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return base
  }
  let out = base
  for (const [key, value] of Object.entries(raw ?? {})) {
    try {
      out = mergeSettings(out, { [key]: value })
    } catch {}
  }
  return out
}

export function writeSettings(settings: SideSettings, file = settingsPath()): void {
  secureDir(path.dirname(file))
  const tmp = `${file}.${process.pid}.tmp`
  fs.rmSync(tmp, { force: true })
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), { mode: 0o600, flag: 'wx' })
  fs.renameSync(tmp, file)
  fs.chmodSync(file, 0o600)
}

export function updateSettings(patch: Record<string, unknown>, file = settingsPath()): SideSettings {
  const next = mergeSettings(readSettings(file), patch)
  writeSettings(next, file)
  return next
}
