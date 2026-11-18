import fs from 'fs'
import os from 'os'
import path from 'path'

export interface Claim {
  surface: string
  at?: number
  focus?: string[]
}

/** Claims keyed by their file name, which is the scope with `[^\w.-]` replaced by `_`. */
export type Claims = Record<string, Claim>

export const CLAIMS_DIR = path.join(os.homedir(), '.claude', 'agent-orchestration', 'main')

export const claimKey = (scope: string): string => scope.replace(/[^\w.-]/g, '_')

export function readClaims(dir = CLAIMS_DIR): Claims {
  let files: string[] = []
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
  } catch {
    return {}
  }
  const claims: Claims = {}
  for (const file of files) {
    try {
      const claim = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as Claim
      if (typeof claim?.surface === 'string' && claim.surface) claims[file.slice(0, -5)] = claim
    } catch {
      continue
    }
  }
  return claims
}

/** A claim counts only when its surface is this live agent, so stale claims (never cleared) mark nobody. */
export function isMainFor(claims: Claims, scope: string | null, surface: string): boolean {
  return !!scope && claims[claimKey(scope)]?.surface === surface
}
