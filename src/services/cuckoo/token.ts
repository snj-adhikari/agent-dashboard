import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { IncomingMessage, ServerResponse } from 'http'

export const tokenPath = (): string => process.env.CUCKOO_TOKEN_PATH || path.join(os.homedir(), '.config', 'agent-monitor', 'token')

/** Reads the bearer token, creating it (32 random bytes, hex, mode 0600) on first use. */
export function ensureToken(file = tokenPath()): string {
  try {
    const existing = fs.readFileSync(file, 'utf8').trim()
    if (existing) {
      fs.chmodSync(file, 0o600)
      return existing
    }
  } catch {}
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const token = crypto.randomBytes(32).toString('hex')
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 })
  fs.chmodSync(file, 0o600)
  return token
}

const digest = (s: string): Buffer => crypto.createHash('sha256').update(s).digest()

export function requireToken(req: IncomingMessage, res: ServerResponse): boolean {
  const given = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ''))?.[1] || ''
  if (given && crypto.timingSafeEqual(digest(given), digest(ensureToken()))) return true
  res.writeHead(401, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: false, error: 'unauthorised', message: 'missing or wrong bearer token' }))
  return false
}
