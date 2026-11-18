import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { IncomingMessage, ServerResponse } from 'http'
import { readJsonBody } from '../http'
import { SESSION_RE, SNJ_TERM } from '../services/herdr'
import { shellQuote } from '../services/cmuxControl'
import { requireToken } from '../services/cuckoo/token'
import { addressOf, CuckooError, logRelay, normalise, relayKey, shortHash } from '../services/cuckoo/relayLog'
import { assertFresh, io, notFlag, polledAgent, sendKeys, typeText } from '../services/cuckoo/keys'
import { pendingApproval, readDialog } from '../services/cuckoo/promptParse'
import { noteSent } from '../services/cuckoo/replyParse'
import type { Agent } from '../services/cuckoo/agents'

const MAX_TEXT = 4000
const CLIS = new Set(['claude', 'copilot', 'gemini', 'codex', 'cursor-agent', 'opencode'])
const GIT_GRANT = /\bgit\b[^;&|]*?\s(commit|push)\b/
const AGENT_NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/

type Body = Record<string, unknown>
type Decision = 'allow' | 'always' | 'deny'

/** True when any command in the dialog runs git commit or git push, flags between git and the subcommand included. */
export const isGitGrant = (text: string): boolean => GIT_GRANT.test(normalise(text))

const str = (v: unknown, field: string): string => {
  if (typeof v !== 'string' || !v.trim()) throw new CuckooError('bad_request', `${field} is required`)
  return v
}

function agentFor(id: unknown): Agent {
  const agent = polledAgent(str(id, 'agentId'))
  if (!agent) throw new CuckooError('unknown_agent', `no agent ${String(id)}`)
  return agent
}

/** allow → 1, always → 2 (only on a three-option dialog), deny → Escape. */
export function decisionKey(decision: unknown, optionCount: number): string {
  if (decision === 'allow') return '1'
  if (decision === 'deny') return 'Escape'
  if (decision === 'always' && optionCount === 3) return '2'
  throw new CuckooError('bad_request', `decision ${String(decision)} is not available here`)
}

/** Opens `<cli>` in a login shell; the prompt arrives through a 0600 file read into an env var, never on the command line. */
export function launchCommand(cli: string, promptFile?: string): string {
  if (!promptFile) return `zsh -lc ${shellQuote(`exec ${cli}`)}`
  return `zsh -lc ${shellQuote(`export CUCKOO_PROMPT="$(cat "$1")"; rm -f "$1"; exec ${cli} "$CUCKOO_PROMPT"`)} cuckoo ${shellQuote(promptFile)}`
}

async function say(body: Body): Promise<object> {
  const agent = agentFor(body.agentId)
  const text = normalise(str(body.text, 'text'))
  if (text.length > MAX_TEXT) throw new CuckooError('bad_request', 'text is too long')
  if (!agent.canSend) throw new CuckooError('cannot_send', `${agent.id} is read-only`)
  const key = relayKey(agent)
  await assertFresh(agent)
  const sha256 = logRelay(key, text)
  await typeText(agent, text)
  noteSent(agent.id)
  return { ok: true, relayKey: key, sha256 }
}

async function approve(body: Body): Promise<object> {
  const found = pendingApproval(str(body.id, 'id'))
  if (!found) throw new CuckooError('stale', 'that prompt is no longer pending')
  const { approval, agent, text } = found
  if (isGitGrant(`${approval.command}\n${text}`)) throw new CuckooError('grant_in_terminal', 'answer commit/push in the terminal')
  const decision = body.decision as Decision
  const ask = approval.tool === 'ask'
  const sent = ask ? (decision === 'allow' ? 'Approved' : decision === 'deny' ? 'Denied' : decisionKey(decision, 2)) : decisionKey(decision, approval.options.length)
  await assertFresh(agent)
  const now = await readDialog(agent)
  if (!now || shortHash(now.text) !== approval.screenHash) throw new CuckooError('stale', 'the prompt changed on screen')
  logRelay(relayKey(agent), sent)
  if (ask) await typeText(agent, sent)
  else await sendKeys(agent, [sent])
  return { ok: true, sent }
}

async function focus(body: Body): Promise<object> {
  const agent = agentFor(body.agentId)
  if (agent.host !== 'herdr') return { ok: true, focused: false }
  const { session } = addressOf(agent)
  const name = agent.codename || agent.name
  if (!SESSION_RE.test(session) || !AGENT_NAME_RE.test(name)) return { ok: true, focused: false }
  await io.run(SNJ_TERM, ['attach', session, name])
  return { ok: true, focused: true }
}

export const launchDir = (): string => process.env.CUCKOO_LAUNCH_DIR || os.tmpdir()

async function launch(body: Body): Promise<object> {
  const cli = str(body.cli, 'cli')
  if (!CLIS.has(cli)) throw new CuckooError('bad_request', `unknown cli ${cli}`)
  const cwd = str(body.cwd, 'cwd')
  if (!path.isAbsolute(cwd) || !fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) throw new CuckooError('bad_request', 'cwd must be an existing absolute folder')
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (prompt.length > MAX_TEXT) throw new CuckooError('bad_request', 'prompt is too long')
  let file: string | undefined
  if (prompt) {
    file = path.join(launchDir(), `cuckoo-launch-${crypto.randomBytes(8).toString('hex')}`)
    fs.writeFileSync(file, notFlag(prompt), { mode: 0o600, flag: 'wx' })
  }
  try {
    return { ok: true, ref: io.openTab(`${cli} · ${path.basename(cwd)}`, cwd, launchCommand(cli, file)) }
  } catch (e) {
    if (file) fs.rmSync(file, { force: true })
    throw e
  }
}

const ACTIONS = new Map<string, (body: Body) => Promise<object>>([['say', say], ['approve', approve], ['focus', focus], ['launch', launch]])

function fail(res: ServerResponse, e: unknown): void {
  const err = e instanceof CuckooError ? e : new CuckooError('host_failed', (e as Error)?.message || 'host command failed')
  res.writeHead(err.status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: false, error: err.code, message: err.message }))
}

/** Handles POST say/approve/focus/launch under /api/v1/cuckoo/; false for any other path. */
export async function handleCuckooAction(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const action = ACTIONS.get(url.pathname.replace(/^\/api\/v1\/cuckoo\//, ''))
  if (!url.pathname.startsWith('/api/v1/cuckoo/') || !action) return false
  if (!requireToken(req, res)) return true
  try {
    if (req.method !== 'POST') throw new CuckooError('bad_request', 'POST only')
    const result = await action(await readJsonBody(req))
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result))
  } catch (e) {
    fail(res, e)
  }
  return true
}
