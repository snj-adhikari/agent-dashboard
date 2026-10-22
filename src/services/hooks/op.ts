import { execFileSync } from 'child_process'

export class OpLockedError extends Error {}

// ponytail: fallback path only — the claude-CLI/MCP poll path is primary and normally needs no secret.
export function opRead(ref: string): string {
  try {
    return execFileSync('op', ['read', ref], { encoding: 'utf8' }).trim()
  } catch (e) {
    const stderr = (e as { stderr?: string }).stderr || ''
    if (/sign in|not signed in|locked/i.test(stderr)) throw new OpLockedError(stderr)
    throw e
  }
}
