import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export const KNOWN_CLIS = ['claude', 'copilot', 'gemini', 'codex', 'cursor-agent', 'opencode'] as const
const TIMEOUT_MS = 3000
const CACHE_MS = 60_000

export interface CliInfo {
  cli: string
  path: string
  version: string | null
  signedIn: boolean | 'unknown'
}

let cache: { at: number; clis: Promise<CliInfo[]> } | null = null

async function out(cmd: string, args: string[]): Promise<string> {
  try {
    return (await execFileAsync(cmd, args, { encoding: 'utf8', timeout: TIMEOUT_MS })).stdout.trim()
  } catch {
    return ''
  }
}

/** A login shell so PATH matches what the user's terminal sees. */
async function detect(cli: string): Promise<CliInfo | null> {
  const found = (await out('zsh', ['-lc', `command -v ${cli}`])).split('\n').pop() || ''
  if (!found.startsWith('/')) return null
  const version = (await out(found, ['--version'])).split('\n')[0] || null
  return { cli, path: found, version, signedIn: 'unknown' }
}

/** Login state stays "unknown": none of these CLIs has a status command we rely on, and credential files are never read. */
export function localClis(): Promise<CliInfo[]> {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    cache = { at: Date.now(), clis: Promise.all(KNOWN_CLIS.map(detect)).then((r) => r.filter((c): c is CliInfo => !!c)) }
  }
  return cache.clis
}
