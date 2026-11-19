import type { EngineInterface as Engine, On, PluginOptions } from 'claude-code'
import { fold, REGISTRY_FILE, type RegistryRow } from './balances'
import { guidelinesBlock, regenerate } from './files'
import { identity, ledgerDir, LEDGER_FILE, read, readLines, stateDir, writeAtomic, type LedgerEvent } from './ledger'
import { reminderText } from './reminder'
import { strictRules } from './strict'

export const SYNC_FILE = 'sync.json'
const DEFAULT_URL = 'http://localhost:5818'

type SyncState = { ledger: string; offset: number }

const num = (value: unknown, fallback: number): number => {
  const n = Number(value)
  return value !== undefined && value !== '' && Number.isFinite(n) && n > 0 ? n : fallback
}

async function post($: Engine, base: string, dir: string, line: string): Promise<boolean> {
  let event: unknown
  try {
    event = JSON.parse(line)
  } catch {
    return true
  }
  const res = await $.http
    .fetch(`${base}/api/v1/demerits`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event, ledgerDir: dir }) })
    .catch(() => undefined)
  if (!res?.ok) return false
  try {
    return (JSON.parse(res.text) as { ok?: boolean }).ok !== false
  } catch {
    return true
  }
}

export async function syncLedger($: Engine, cfg: PluginOptions): Promise<boolean> {
  const dir = await ledgerDir($, cfg)
  const path = `${dir}/${LEDGER_FILE}`
  if (!(await $.fs.exists(path))) return false
  const text = (await $.fs.read(path)) as string
  const statePath = `${await stateDir($)}/${SYNC_FILE}`
  const [saved] = await readLines<SyncState>($, statePath)
  const from = saved?.ledger === path && saved.offset >= 0 && saved.offset <= text.length ? saved.offset : 0
  const end = text.lastIndexOf('\n') + 1
  if (end <= from) return false
  const base = (await $.env.get('AGENT_MONITOR_URL')) || DEFAULT_URL
  let offset = from
  for (const line of text.slice(from, end).split('\n').slice(0, -1)) {
    if (line.trim() && !(await post($, base, dir, line))) break
    offset += line.length + 1
  }
  if (offset !== from) {
    await $.process.run(['mkdir', '-p', await stateDir($)])
    await writeAtomic($, statePath, `${JSON.stringify({ ledger: path, offset })}\n`)
  }
  return end > from
}

async function syncAll($: Engine, cfg: PluginOptions): Promise<void> {
  try {
    if (await syncLedger($, cfg)) await regenerate($, cfg)
  } catch {
    return
  }
}

export async function syncTurnComplete($: Engine, e: any, next: (e: any) => any, cfg: PluginOptions) {
  const out = await next(e)
  await syncAll($, cfg)
  return out
}

export async function syncSessionStart($: Engine, e: any, next: (e: any) => any, cfg: PluginOptions) {
  const out = await next(e)
  await syncAll($, cfg)
  return out
}

async function reminderFor($: Engine, cfg: PluginOptions): Promise<string> {
  const now = await $.clock.now()
  const windowDays = num(cfg.windowDays, 7)
  const agent = await identity($)
  const events = await read($, cfg)
  const registry = await readLines<RegistryRow>($, `${await stateDir($)}/${REGISTRY_FILE}`)
  const strict = strictRules(events as LedgerEvent[], agent, now, num(cfg.threshold, 3), windowDays)
  return reminderText(fold(events, registry, now, windowDays), events, agent, strict, now, windowDays)
}

async function withContext(out: any, parts: string[]) {
  const text = parts.filter(Boolean)
  return text.length ? { ...(out ?? {}), additionalContext: [...(out?.additionalContext ?? []), ...text] } : out
}

async function safe(job: () => Promise<string>): Promise<string> {
  try {
    return await job()
  } catch {
    return ''
  }
}

export async function syncClassicSessionStart($: Engine, e: any, next: (e: any) => any, cfg: PluginOptions) {
  const out = await next(e)
  const fresh = e.source === 'startup' || e.source === 'clear'
  return withContext(out, [await safe(() => reminderFor($, cfg)), fresh ? await safe(() => guidelinesBlock($, cfg)) : ''])
}

export async function syncClassicSubagentStart($: Engine, e: any, next: (e: any) => any, cfg: PluginOptions) {
  const out = await next(e)
  return withContext(out, [await safe(() => guidelinesBlock($, cfg))])
}

export function install(_on: On, _cfg: PluginOptions): void {}
