import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/** Each CLI's own status command; exit 0 means signed in. Null means no command we rely on, so "unknown". */
const STATUS_ARGS: Record<string, string[] | null> = {
  claude: ['auth', 'status', '--json'],
  opencode: ['auth', 'list'],
  codex: ['login', 'status'],
  'cursor-agent': ['status'],
  copilot: null,
  gemini: null,
}
export const KNOWN_CLIS = Object.keys(STATUS_ARGS)
export const CHAT_CLIS = ['claude']
const TIMEOUT_MS = 3000
const CACHE_MS = 60_000

export interface CliInfo {
  cli: string
  path: string
  version: string | null
  signedIn: boolean | 'unknown'
  chat: boolean
}

let cache: { at: number; clis: Promise<CliInfo[]> } | null = null

async function out(cmd: string, args: string[]): Promise<string> {
  try {
    return (await execFileAsync(cmd, args, { encoding: 'utf8', timeout: TIMEOUT_MS })).stdout.trim()
  } catch {
    return ''
  }
}

/** Never reads credential files: only the CLI's exit code counts. A timeout, crash by signal or missing binary stays "unknown". */
export async function signedInOf(cli: string, bin: string, timeoutMs = TIMEOUT_MS): Promise<boolean | 'unknown'> {
  const args = STATUS_ARGS[cli]
  if (!args) return 'unknown'
  try {
    await execFileAsync(bin, args, { encoding: 'utf8', timeout: timeoutMs })
    return true
  } catch (e) {
    const code = (e as { code?: unknown }).code
    return typeof code === 'number' ? false : 'unknown'
  }
}

export async function cliInfo(cli: string, bin: string): Promise<CliInfo> {
  const [version, signedIn] = await Promise.all([out(bin, ['--version']), signedInOf(cli, bin)])
  return { cli, path: bin, version: version.split('\n')[0] || null, signedIn, chat: signedIn === true && CHAT_CLIS.includes(cli) }
}

/** A login shell so PATH matches what the user's terminal sees. */
async function detect(cli: string): Promise<CliInfo | null> {
  const found = (await out('zsh', ['-lc', `command -v ${cli}`])).split('\n').pop() || ''
  return found.startsWith('/') ? cliInfo(cli, found) : null
}

export function localClis(): Promise<CliInfo[]> {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    cache = { at: Date.now(), clis: Promise.all(KNOWN_CLIS.map(detect)).then((r) => r.filter((c): c is CliInfo => !!c)) }
  }
  return cache.clis
}
