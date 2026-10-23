import { execFileSync } from 'child_process'

const CLIS = ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale']
const TTL_MS = 60_000

export interface TailnetSelf {
  host: string
  login: string
}

let cache: { at: number; self: TailnetSelf | null } | null = null

function status(): Record<string, any> | null {
  for (const cli of CLIS) {
    try {
      return JSON.parse(execFileSync(cli, ['status', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }))
    } catch {}
  }
  return null
}

/** This machine's MagicDNS name and its owner's login, or null while Tailscale is down. */
export function tailnetSelf(): TailnetSelf | null {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.self
  const s = status()
  const host = String(s?.Self?.DNSName || '').replace(/\.$/, '')
  const login = s?.User?.[String(s?.Self?.UserID)]?.LoginName
  cache = { at: Date.now(), self: s?.BackendState === 'Running' && host && login ? { host, login } : null }
  return cache.self
}
