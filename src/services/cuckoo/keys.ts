import { execFile } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { herdrEnv } from '../herdr'
import { openTab, tmuxKey } from '../terminal'
import { addressOf, CuckooError, type Address } from './relayLog'
import type { Agent } from './agents'

export type Runner = (cmd: string, args: string[], env?: NodeJS.ProcessEnv) => Promise<string>

const execFileAsync = promisify(execFile)
const HC_LOCAL = path.join(os.homedir(), '.local', 'bin', 'hc')

export const execRunner: Runner = async (cmd, args, env) => (await execFileAsync(cmd, args, { encoding: 'utf8', timeout: 5000, env: env || process.env })).stdout

let polled = new Map<string, Agent>()

/** I/O seams: tests swap these; `fresh` should return a new discovery pass (defaults to the last poll). */
export const io = {
  run: execRunner,
  fresh: async (): Promise<Agent[]> => polledAgents(),
  openTab
}

export function rememberAgents(agents: Agent[]): void {
  polled = new Map(agents.map((a) => [a.id, a]))
}

export const polledAgent = (id: string): Agent | undefined => polled.get(id)

export const polledAgents = (): Agent[] => [...polled.values()]

/** The pill the client clicked must still be the same agent at the same address with the same codename. */
export async function assertFresh(agent: Agent): Promise<void> {
  const now = (await io.fresh()).find((a) => a.id === agent.id)
  if (!now || now.codename !== agent.codename || now.host !== agent.host) throw new CuckooError('stale', `${agent.codename || agent.id} changed since the last poll`)
}

const hcBin = (): string => (fs.existsSync(HC_LOCAL) ? HC_LOCAL : 'hc')
const herdrRun = (a: Address, args: string[]): Promise<string> => io.run('herdr', args, herdrEnv(process.env, a.session))
const cmuxSurface = (a: Address): string[] => (a.pane ? ['--surface', a.pane] : [])

/** A leading space keeps text that starts with `-` from being read as a flag by any host CLI; the relay hash trims it. */
export const notFlag = (text: string): string => (text.startsWith('-') ? ` ${text}` : text)

export async function typeText(agent: Agent, raw: string): Promise<void> {
  const a = addressOf(agent)
  const text = notFlag(raw)
  if (a.host === 'herdr') await herdrRun(a, ['agent', 'prompt', a.pane, text])
  else if (a.host === 'herdr-app') await io.run(hcBin(), ['send', a.pane, text])
  else if (a.host === 'cmux') await io.run('cmux', ['send', '--workspace', a.session, ...cmuxSurface(a), `${text}\n`])
  else {
    await io.run('tmux', ['send-keys', '-t', a.session, '-l', text])
    await io.run('tmux', ['send-keys', '-t', a.session, 'Enter'])
  }
}

export async function sendKeys(agent: Agent, keys: string[]): Promise<void> {
  const a = addressOf(agent)
  if (a.host === 'herdr') await herdrRun(a, ['agent', 'send-keys', a.pane, ...keys])
  else if (a.host === 'herdr-app') await io.run(hcBin(), ['keys', a.pane, ...keys.map((k) => k.toLowerCase())])
  else if (a.host === 'cmux') for (const k of keys) await io.run('cmux', ['send-key', '--workspace', a.session, k.toLowerCase()])
  else for (const k of keys) await io.run('tmux', ['send-keys', '-t', a.session, tmuxKey(k)])
}

export async function readTail(agent: Agent, lines: number): Promise<string> {
  const a = addressOf(agent)
  const n = String(lines)
  let out: string
  if (a.host === 'herdr') out = await herdrRun(a, ['agent', 'read', a.pane, '--source', 'recent', '--lines', n])
  else if (a.host === 'herdr-app') out = await io.run(hcBin(), ['read', a.pane, '--lines', n])
  else if (a.host === 'cmux') out = await io.run('cmux', ['read-screen', '--workspace', a.session, ...cmuxSurface(a)])
  else out = await io.run('tmux', ['capture-pane', '-p', '-t', a.session, '-S', `-${n}`])
  return out.replace(/\s+$/, '').split('\n').slice(-lines).join('\n')
}
