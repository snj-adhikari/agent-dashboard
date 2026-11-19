import { execFile } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { SideId, SideItem } from '../agents'
import { runHeadless } from '../chat'
import { CuckooError } from '../relayLog'
import type { Provider, SideData, SideStatus } from './registry'

const STATUS_TIMEOUT_MS = 3000
const DATA_TIMEOUT_MS = 15_000
const MCP_TIMEOUT_MS = 8000
export const CACHE_MS = 5 * 60_000
const MAX_FIELD = 200
const MAX_ITEMS = 10
const EXTRA_DIRS = ['/opt/homebrew/bin']

const GH_QUERY =
  'query{viewer{pullRequests(first:10,states:OPEN,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number title url repository{nameWithOwner} commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}} search(query:"is:pr is:open review-requested:@me archived:false",type:ISSUE,first:10){nodes{... on PullRequest{number title url repository{nameWithOwner}}}}}'

type CliId = 'github' | 'vercel' | 'stripe' | 'n8n'

/** The only argv each CLI is ever run with; every entry is a read-only verb. */
export const ARGV = {
  github: { bin: 'gh', status: ['auth', 'status', '--active'], data: [['api', 'graphql', '-f', `query=${GH_QUERY}`]] },
  vercel: { bin: 'vercel', status: ['whoami'], data: [['list', '--json']] },
  stripe: { bin: 'stripe', status: ['get', '/v1/balance'], data: [['get', '/v1/balance'], ['get', '/v1/charges', '--limit', '5']] },
  n8n: { bin: 'n8n', status: null, data: [['list:workflow']] },
} as const satisfies Record<CliId, { bin: string; status: readonly string[] | null; data: readonly (readonly string[])[] }>

type ConnectorId = 'notion' | 'calcom' | 'resend'

/** claude.ai connector name plus the exact read tools the headless run may use. */
export const CONNECTORS: Record<ConnectorId, { name: string; tools: string[]; task: string }> = {
  notion: { name: 'claude.ai Notion', tools: ['mcp__claude_ai_Notion__notion-search', 'mcp__claude_ai_Notion__notion-fetch'], task: 'List up to 10 Notion pages I edited most recently.' },
  calcom: { name: 'claude.ai Cal.com', tools: ['mcp__claude_ai_Cal_com__get_bookings'], task: 'List my next 10 upcoming Cal.com bookings.' },
  resend: { name: 'claude.ai Resend', tools: ['mcp__claude_ai_Resend__list_emails'], task: 'List the 10 most recent emails sent through Resend and their status.' },
}

export const NO_ACCESS = 'NO_ACCESS'
export const MAX_REPLY = 64 * 1024

export type Exec = (bin: string, args: readonly string[], timeoutMs: number) => Promise<{ code: number | null; stdout: string }>

const exec: Exec = (bin, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(bin, [...args], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024, cwd: os.tmpdir() }, (err, stdout) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : null) : 0
      resolve({ code, stdout: String(stdout ?? '') })
    })
  })

function which(bin: string): string | null {
  const dirs = [...(process.env.PATH || '').split(path.delimiter), ...EXTRA_DIRS].filter((d) => path.isAbsolute(d))
  for (const d of dirs) {
    const p = path.join(d, bin)
    try {
      fs.accessSync(p, fs.constants.X_OK)
      if (fs.statSync(p).isFile()) return p
    } catch {}
  }
  return null
}

export const servicesDeps: { exec: Exec; which: (bin: string) => string | null; headless: typeof runHeadless; openUrl: (url: string) => void; now: () => number } = {
  exec,
  which,
  headless: runHeadless,
  openUrl: (url) => execFile('open', [url], () => undefined),
  now: () => Date.now(),
}

const statusCache = new Map<SideId, { at: number; status: SideStatus }>()
const lastItems = new Map<SideId, SideItem[]>()

export function clearServicesCache(): void {
  statusCache.clear()
  lastItems.clear()
}

async function cached(id: SideId, probe: () => Promise<{ status: SideStatus; keep: boolean }>): Promise<SideStatus> {
  const hit = statusCache.get(id)
  if (hit && servicesDeps.now() - hit.at < CACHE_MS) return hit.status
  const { status, keep } = await probe()
  if (keep) statusCache.set(id, { at: servicesDeps.now(), status })
  return status
}

/** Signed in = the CLI's own status command exits 0; a timeout is not cached so the next poll retries. */
async function cliStatus(id: CliId): Promise<SideStatus> {
  return cached(id, async () => {
    const spec = ARGV[id]
    const bin = servicesDeps.which(spec.bin)
    if (!bin) return { status: { available: false, via: null, reason: 'not_installed' }, keep: true }
    if (!spec.status) return { status: { available: true, via: 'cli', reason: null }, keep: true }
    const { code } = await servicesDeps.exec(bin, spec.status, STATUS_TIMEOUT_MS)
    if (code === 0) return { status: { available: true, via: 'cli', reason: null }, keep: true }
    return { status: { available: false, via: 'cli', reason: 'signed_out' }, keep: code !== null }
  })
}

/** `claude mcp get` exits non-zero when the connector is absent; anything but Connected means it needs signing in. */
async function connectorStatus(id: ConnectorId): Promise<SideStatus> {
  return cached(id, async () => {
    const claude = servicesDeps.which('claude')
    if (!claude) return { status: { available: false, via: null, reason: 'needs_key' }, keep: true }
    const { code, stdout } = await servicesDeps.exec(claude, ['mcp', 'get', CONNECTORS[id].name], MCP_TIMEOUT_MS)
    const ok = code === 0 && /Status:\s*\S*\s*Connected/i.test(stdout)
    return { status: ok ? { available: true, via: 'mcp', reason: null } : { available: false, via: null, reason: 'needs_key' }, keep: code !== null }
  })
}

const clean = (v: unknown, max = MAX_FIELD): string | null => (typeof v === 'string' && v.trim() ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : null)
const httpsUrl = (v: unknown): string | null => {
  const s = clean(v, 500)
  return s && /^https:\/\/[^\s]+$/.test(s) ? s : null
}
const parseJson = (s: string): unknown => {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
const item = (id: string, title: string | null, extra: Partial<SideItem> = {}): SideItem => ({ id, title: title || '(untitled)', subtitle: null, value: null, url: null, tone: null, group: null, actions: [], ...extra })
const withOpen = (i: SideItem): SideItem => (i.url ? { ...i, actions: ['open'] } : i)
const TONE: Record<string, SideItem['tone']> = { SUCCESS: 'ok', READY: 'ok', succeeded: 'ok', FAILURE: 'error', ERROR: 'error', failed: 'error', PENDING: 'warn', BUILDING: 'warn', QUEUED: 'warn', pending: 'warn' }

type Rec = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export function parseGithub(out: string): SideItem[] {
  const d = (parseJson(out) as Rec | null)?.data ?? {}
  const pr = (p: Rec, group: string): SideItem => {
    const state = p?.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state
    return item(`${group}:${clean(p?.repository?.nameWithOwner) ?? ''}#${Number(p?.number) || 0}`, clean(p?.title), { subtitle: clean(p?.repository?.nameWithOwner), value: clean(state) ?? null, url: httpsUrl(p?.url), tone: TONE[state] ?? null, group })
  }
  const nodes = (x: unknown): Rec[] => (Array.isArray(x) ? x.filter((n) => n && typeof n === 'object' && n.number) : [])
  return [...nodes(d?.search?.nodes).map((p) => pr(p, 'review')), ...nodes(d?.viewer?.pullRequests?.nodes).map((p) => pr(p, 'mine'))].map(withOpen)
}

export function parseVercel(out: string): SideItem[] {
  const j = parseJson(out) as Rec | null
  const list: Rec[] = Array.isArray(j?.deployments) ? j!.deployments : Array.isArray(j) ? (j as Rec[]) : []
  return list.slice(0, MAX_ITEMS).map((d, i) => {
    const state = d?.state ?? d?.readyState
    const url = typeof d?.url === 'string' ? (d.url.startsWith('https://') ? d.url : `https://${d.url}`) : null
    return withOpen(item(clean(d?.uid) ?? String(i), clean(d?.name) ?? clean(d?.url), { subtitle: clean(d?.target), value: clean(state), url: httpsUrl(url), tone: TONE[state] ?? null }))
  })
}

const money = (amount: unknown, currency: unknown): string | null => (typeof amount === 'number' && typeof currency === 'string' ? `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}` : null)

export function parseStripe(balanceOut: string, chargesOut: string): SideItem[] {
  const bal = parseJson(balanceOut) as Rec | null
  const balance = (Array.isArray(bal?.available) ? bal!.available : []).map((b: Rec, i: number) => item(`balance:${i}`, 'Available balance', { value: money(b?.amount, b?.currency), group: 'balance' }))
  const charges = (Array.isArray((parseJson(chargesOut) as Rec | null)?.data) ? (parseJson(chargesOut) as Rec).data : []).slice(0, 5).map((c: Rec, i: number) =>
    item(clean(c?.id) ?? String(i), clean(c?.description) ?? 'Charge', { subtitle: clean(c?.status), value: money(c?.amount, c?.currency), tone: TONE[c?.status] ?? null, group: 'charges' })
  )
  return [...balance, ...charges]
}

export function parseN8n(out: string): SideItem[] {
  return out
    .split('\n')
    .map((l) => /^([^|\s]+)\|(.+)$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .slice(0, MAX_ITEMS)
    .map((m) => item(clean(m[1])!, clean(m[2])))
}

/** Model output is untrusted: only a JSON array of {title, subtitle, url} is kept, fields capped, URLs https only. */
export function parseConnector(raw: string): SideItem[] {
  const out = raw.slice(0, MAX_REPLY)
  if (out.split('\n').some((l) => l.trim() === NO_ACCESS)) throw new CuckooError('needs_key', 'connector absent or denied')
  const arr = parseJson(/\[[\s\S]*\]/.exec(out)?.[0] ?? '')
  if (!Array.isArray(arr)) return []
  return arr
    .filter((x) => x && typeof x === 'object')
    .slice(0, MAX_ITEMS)
    .map((x: Rec, i) => withOpen(item(String(i), clean(x.title), { subtitle: clean(x.subtitle), url: httpsUrl(x.url) })))
}

export const connectorPrompt = (task: string): string =>
  [task, `Use only the tools you were given, read-only. Answer with a JSON array only: [{"title":"...","subtitle":"...","url":"https://..."}]. If those tools are missing, fail or are denied, answer exactly ${NO_ACCESS}.`].join('\n')

async function runCli(id: CliId, args: readonly string[]): Promise<string> {
  const bin = servicesDeps.which(ARGV[id].bin)
  if (!bin) throw new CuckooError('not_installed', `${ARGV[id].bin} is not installed`)
  const { code, stdout } = await servicesDeps.exec(bin, args, DATA_TIMEOUT_MS)
  if (code === null) throw new CuckooError('timeout', `${ARGV[id].bin} did not answer`)
  if (code !== 0) throw new CuckooError('signed_out', `${ARGV[id].bin} failed; check its sign-in`)
  return stdout
}

async function cliData(id: CliId): Promise<SideItem[]> {
  const outs: string[] = []
  for (const args of ARGV[id].data) outs.push(await runCli(id, args))
  if (id === 'github') return parseGithub(outs[0])
  if (id === 'vercel') return parseVercel(outs[0])
  if (id === 'stripe') return parseStripe(outs[0], outs[1])
  return parseN8n(outs[0])
}

function provider(id: CliId | ConnectorId): Provider {
  const isCli = id in ARGV
  const status = (): Promise<SideStatus> => (isCli ? cliStatus(id as CliId) : connectorStatus(id as ConnectorId))
  return {
    id,
    actions: [],
    status,
    data: async (): Promise<SideData | null> => {
      const s = await status()
      if (!s.available) throw new CuckooError(s.reason === 'signed_out' ? 'signed_out' : s.reason === 'needs_key' ? 'needs_key' : 'not_installed', `${id} is not available`)
      const items = isCli ? await cliData(id as CliId) : parseConnector(await servicesDeps.headless(connectorPrompt(CONNECTORS[id as ConnectorId].task), { allowedTools: CONNECTORS[id as ConnectorId].tools }))
      lastItems.set(id, items)
      return { items, summary: items.length ? null : 'Nothing to show.' }
    },
    action: async (action, itemId) => {
      if (action !== 'open') throw new CuckooError('bad_request', `${id} does not allow ${action}`)
      const url = lastItems.get(id)?.find((i) => i.id === itemId)?.url
      if (!url) throw new CuckooError('bad_request', 'unknown item; refresh first')
      servicesDeps.openUrl(url)
      return null
    },
  }
}

export const providers = (['github', 'vercel', 'stripe', 'n8n', 'resend', 'notion', 'calcom'] as const).map(provider)
