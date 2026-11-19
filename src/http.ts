import type { IncomingMessage, ServerResponse } from 'http'
import { tailnetSelf } from './services/tailnet'

const MAX_BODY = 1_000_000

/** Malformed or oversized bodies resolve to {} so a bad request can't crash the server. */
export function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > MAX_BODY) req.destroy()
    })
    req.on('close', () => resolve({}))
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch {
        resolve({})
      }
    })
  })
}

/** *.localhost is a reserved TLD (RFC 6761) that always resolves to loopback, so a subdomain alias is as trustworthy as localhost itself. */
function isLoopbackHost(host: string, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host.endsWith(`.localhost:${port}`)
}

/** `tailscale serve` keeps the MagicDNS Host and sets Tailscale-User-Login itself, stripping any copy the client sent. */
function isTailnetOwner(req: IncomingMessage, host: string): boolean {
  const self = tailnetSelf()
  return !!self && host === self.host && req.headers['tailscale-user-login'] === self.login
}

/**
 * The API can type into live agent terminals, so reject anything not from the local dashboard:
 * a foreign Host blocks DNS rebinding; JSON-only POSTs force a CORS preflight a foreign page can't pass.
 */
export function isTrustedRequest(req: IncomingMessage, port: number): boolean {
  const host = req.headers.host || ''
  const tailnet = !isLoopbackHost(host, port) && isTailnetOwner(req, host)
  if (!tailnet && !isLoopbackHost(host, port)) return false
  if (req.method !== 'POST') return true
  const origin = req.headers.origin
  if (origin && origin !== `${tailnet ? 'https' : 'http'}://${host}`) return false
  const type = req.headers['content-type'] || ''
  if (type.startsWith('application/json')) return true
  return type.startsWith('application/octet-stream') && isUploadPath(req.url) && /^Bearer\s+\S+$/i.test(String(req.headers.authorization || ''))
}

/** Raw uploads skip the JSON rule only here; the Bearer header still forces a preflight a foreign page can't pass. */
const isUploadPath = (url: string | undefined): boolean => (url || '').split('?')[0] === '/api/v1/cuckoo/upload'

export function sendJson(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}
