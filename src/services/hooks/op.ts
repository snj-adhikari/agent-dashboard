import { execFileSync } from 'child_process'
import os from 'os'

export class OpLockedError extends Error {}

export function openOpUnlockTab(): void {
  execFileSync('cmux', ['workspace', 'create', '--name', 'op-unlock', '--cwd', os.homedir(), '--command', 'op signin', '--focus', 'false'], {
    encoding: 'utf8'
  })
}

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
