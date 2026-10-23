import { execFileSync } from 'child_process'

const CLIS = ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale']
const TTL_MS = 60_000

export interface TailnetSelf {
  host: string
  login: string
}

let cache: { at: number; self: TailnetSelf | null } | null = null

function cliJson(args: string[]): Record<string, any> | null {
  for (const cli of CLIS) {
    try {
      return JSON.parse(execFileSync(cli, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }))
    } catch {}
  }
  return null
}

const status = (): Record<string, any> | null => cliJson(['status', '--json'])

/** This machine's MagicDNS name and its owner's login, or null while Tailscale is down. */
export function tailnetSelf(): TailnetSelf | null {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.self
  const s = status()
  const host = String(s?.Self?.DNSName || '').replace(/\.$/, '')
  const login = s?.User?.[String(s?.Self?.UserID)]?.LoginName
  cache = { at: Date.now(), self: s?.BackendState === 'Running' && host && login ? { host, login } : null }
  return cache.self
}

export interface TailscaleSetup {
  installed: boolean
  running: boolean
  host: string
  serving: boolean
}

const proxiesTo = (port: number) => (handler: { Proxy?: string }): boolean =>
  !!handler.Proxy && [`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(handler.Proxy.replace(/\/$/, ''))

export function tailscaleSetup(port: number): TailscaleSetup {
  const s = status()
  const self = s ? tailnetSelf() : null
  const web = (cliJson(['serve', 'status', '--json'])?.Web || {}) as Record<string, { Handlers?: Record<string, { Proxy?: string }> }>
  const serving = Object.values(web).some((site) => Object.values(site.Handlers || {}).some(proxiesTo(port)))
  return { installed: !!s, running: !!self, host: self?.host || '', serving }
}

/** Publishes the dashboard to the tailnet only; when Serve is off for the tailnet, returns the admin link that enables it. */
export function publishToTailnet(port: number): { ok: boolean; link?: string; error?: string } {
  let output = ''
  for (const cli of CLIS) {
    try {
      execFileSync(cli, ['serve', '--bg', `http://127.0.0.1:${port}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000 })
      return { ok: true }
    } catch (e) {
      const err = e as { code?: string; stdout?: string; stderr?: string }
      if (err.code === 'ENOENT') continue
      output = `${err.stdout || ''}${err.stderr || ''}`
      break
    }
  }
  const link = output.match(/https:\/\/login\.tailscale\.com\/\S+/)?.[0]
  return { ok: false, link, error: link ? 'Serve is off for this tailnet' : output.trim().slice(0, 300) || 'Tailscale CLI not found' }
}
