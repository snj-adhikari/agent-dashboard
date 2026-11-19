import { spawn, type ChildProcess } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { CHAT_CLIS, localClis, type CliInfo } from './clis'
import { CuckooError } from './relayLog'
import { resolveUpload } from './side/upload'

const MAX_TEXT = 4000
const MAX_TURNS = 20
const MAX_OUT = 1024 * 1024
const ID_RE = /^[\w-]{1,64}$/
const MAX_ATTACHMENTS = 4

/** Read-only headless argv per CLI in CHAT_CLIS; the prompt always goes on stdin. */
export const HEADLESS: Record<string, string[]> = {
  claude: ['-p', '--tools', 'Read,Glob,Grep', '--allowedTools', 'Read,Glob,Grep', '--permission-mode', 'dontAsk', '--no-session-persistence', '--output-format', 'text'],
}

/** Extra argv that lets each CLI read the upload inbox; a CLI missing here takes no attachments. */
const ATTACH_ARGS: Record<string, (dir: string) => string[]> = { claude: (dir) => ['--add-dir', dir] }

interface Turn {
  role: 'user' | 'assistant'
  text: string
}
interface Conversation {
  history: Turn[]
  child: ChildProcess | null
  lastAt: number
}

export const chatDeps: { clis: () => Promise<CliInfo[]>; timeoutMs: number; idleMs: number } = { clis: localClis, timeoutMs: 120_000, idleMs: 30 * 60_000 }
const conversations = new Map<string, Conversation>()
const headless = new Set<{ child: ChildProcess | null }>()

function kill(child: ChildProcess | null): void {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
}

const killAll = (): void => {
  conversations.forEach((c) => kill(c.child))
  headless.forEach((h) => kill(h.child))
}

function drop(id: string): void {
  const convo = conversations.get(id)
  conversations.delete(id)
  if (!convo) return
  const child = convo.child
  convo.child = null
  kill(child)
}

/** Ends every conversation with no request for `chatDeps.idleMs`, killing any running child. */
export function sweepIdle(now = Date.now()): void {
  for (const [id, c] of conversations) if (now - c.lastAt >= chatDeps.idleMs) drop(id)
}
setInterval(sweepIdle, 60_000).unref()
process.once('exit', killAll)
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => {
    killAll()
    process.exit(sig === 'SIGINT' ? 130 : 143)
  })
}

export function promptOf(history: Turn[], text: string): string {
  if (!history.length) return text
  const earlier = history.map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text}`).join('\n\n')
  return `Earlier in this conversation:\n\n${earlier}\n\nUser: ${text}`
}

function run(bin: string, args: string[], prompt: string, convo: { child: ChildProcess | null }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'], detached: true })
    convo.child = child
    let out = ''
    let err = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      kill(child)
    }, chatDeps.timeoutMs)
    child.stdout.on('data', (d: Buffer) => {
      if (out.length < MAX_OUT) out += d.toString('utf8')
    })
    child.stderr.on('data', (d: Buffer) => {
      err = (err + d.toString('utf8')).slice(-2000)
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      if (convo.child === child) convo.child = null
      reject(new CuckooError('host_failed', e.message))
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      const ended = convo.child !== child
      if (!ended) convo.child = null
      if (timedOut) reject(new CuckooError('timeout', `no reply within ${Math.round(chatDeps.timeoutMs / 1000)} s`))
      else if (ended) reject(new CuckooError('stale', 'the conversation was ended'))
      else if (code !== 0) reject(new CuckooError('host_failed', err.trim() || `exited with ${code ?? signal}`))
      else resolve(out.trim())
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(prompt)
  })
}

/** Upload ids only, never client paths; each must resolve to a file inside the inbox. */
export function attachmentsOf(value: unknown, cli: string): string[] {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) throw new CuckooError('bad_request', `attachments must be at most ${MAX_ATTACHMENTS} upload ids`)
  if (value.length && !ATTACH_ARGS[cli]) throw new CuckooError('bad_request', `${cli} takes no attachments`)
  return [...new Set(value.map(resolveUpload))]
}

export const withAttachments = (text: string, files: string[]): string => (files.length ? `${text}\n\nAttached files (read them with the Read tool):\n${files.join('\n')}` : text)

/** Hardlinks (or copies) only the attached uploads into a fresh 0700 dir, so the CLI never sees the rest of the inbox. */
export function stageAttachments(files: string[]): string | null {
  if (!files.length) return null
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-attach-'))
  try {
    fs.chmodSync(dir, 0o700)
    for (const f of files) {
      const dest = path.join(dir, path.basename(f))
      try {
        fs.linkSync(f, dest)
      } catch {
        fs.copyFileSync(f, dest, fs.constants.COPYFILE_EXCL)
      }
      fs.chmodSync(dest, 0o600)
    }
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw new CuckooError('host_failed', `could not stage attachments: ${(e as Error).message}`)
  }
  return dir
}

async function runWithAttachments(bin: string, args: string[], cli: string, prompt: string, files: string[], holder: { child: ChildProcess | null }): Promise<string> {
  const dir = stageAttachments(files)
  try {
    const staged = dir ? files.map((f) => path.join(dir, path.basename(f))) : []
    return await run(bin, dir ? [...args, ...ATTACH_ARGS[cli](dir)] : args, withAttachments(prompt, staged), holder)
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  }
}

async function signedInCli(cli: string) {
  const info = (await chatDeps.clis()).find((c) => c.cli === cli)
  if (!info) throw new CuckooError('bad_request', `${cli} is not installed`)
  if (info.signedIn !== true) throw new CuckooError('signed_out', `${cli} is not signed in`)
  return info
}

/** Tool names go to the CLI as one argv item, so inner hyphens are safe; a leading '-', spaces, commas and quotes are not. */
export const isToolName = (t: string): boolean => /^[\w*][\w*-]*$/.test(t)

/**
 * One-shot headless claude for side providers: prompt on stdin, only `allowedTools` (built-in names or `mcp__*`), no history.
 * An empty list runs with every built-in tool off.
 */
export async function runHeadless(prompt: string, opts: { allowedTools?: string[]; attachments?: string[] } = {}): Promise<string> {
  const tools = opts.allowedTools ?? []
  if (!tools.every(isToolName)) throw new CuckooError('bad_request', 'bad tool name')
  const files = attachmentsOf(opts.attachments ?? null, 'claude')
  const info = await signedInCli('claude')
  const builtIn = tools.filter((t) => !t.startsWith('mcp__'))
  const args = ['-p', '--tools', [...builtIn, ...(files.length ? ['Read'] : [])].join(','), ...(tools.length || files.length ? ['--allowedTools', [...tools, ...(files.length ? ['Read'] : [])].join(',')] : []), '--permission-mode', 'dontAsk', '--no-session-persistence', '--output-format', 'text']
  const holder: { child: ChildProcess | null } = { child: null }
  headless.add(holder)
  try {
    return await runWithAttachments(info.path, args, 'claude', prompt, files, holder)
  } finally {
    headless.delete(holder)
  }
}

export async function chat(body: Record<string, unknown>): Promise<object> {
  const cli = typeof body.cli === 'string' && body.cli ? body.cli : 'claude'
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) throw new CuckooError('bad_request', 'text is required')
  if (text.length > MAX_TEXT) throw new CuckooError('bad_request', 'text is too long')
  const given = body.conversationId
  if (given != null && (typeof given !== 'string' || !ID_RE.test(given))) throw new CuckooError('bad_request', 'bad conversationId')
  const args = CHAT_CLIS.includes(cli) ? HEADLESS[cli] : undefined
  if (!args) throw new CuckooError('bad_request', `${cli} has no headless chat`)
  const files = attachmentsOf(body.attachments, cli)
  const info = await signedInCli(cli)

  sweepIdle()
  const conversationId = (given as string | null | undefined) || crypto.randomUUID()
  const convo = conversations.get(conversationId) ?? { history: [], child: null, lastAt: 0 }
  if (convo.child) throw new CuckooError('stale', 'a reply is still running')
  convo.lastAt = Date.now()
  conversations.set(conversationId, convo)
  const reply = await runWithAttachments(info.path, args, cli, promptOf(convo.history, text), files, convo)
  convo.history = [...convo.history, { role: 'user' as const, text }, { role: 'assistant' as const, text: reply }].slice(-MAX_TURNS)
  return { ok: true, conversationId, cli, text: reply }
}

export async function chatEnd(body: Record<string, unknown>): Promise<object> {
  const id = body.conversationId
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new CuckooError('bad_request', 'conversationId is required')
  drop(id)
  return { ok: true }
}
