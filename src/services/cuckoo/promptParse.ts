import { readTail, rememberAgents } from './keys'
import { addressOf, shortHash } from './relayLog'
import type { Agent, Approval } from './agents'

export const TAIL_LINES = 30
const BOX = /[│┃╭╮╰╯─━]/g
const QUESTION = /^Do you want to .+\?$/
const OPTION = /^(?:[❯>]\s*)?(\d)\.\s+(.+?)(?:\s*\(esc\))?$/
const ASK = /needs your approval/i
const TOOLS: [RegExp, string][] = [
  [/^Bash command$/i, 'Bash'],
  [/^Edit file$/i, 'Edit'],
  [/^(Create|Write) file$/i, 'Write'],
  [/^Read file$/i, 'Read'],
  [/^Fetch$/i, 'WebFetch'],
  [/^Web search$/i, 'WebSearch'],
  [/^Tool use$/i, 'MCP']
]

export interface Dialog {
  tool: string
  command: string
  options: { key: string; label: string }[]
  text: string
}

export const ASK_OPTIONS = [
  { key: 'allow', label: 'Approve' },
  { key: 'deny', label: 'Deny' }
]

/** The last Claude permission dialog in a terminal tail, else the last `needs your approval` line, else null. */
export function parseDialog(tail: string): Dialog | null {
  const lines = tail.split('\n').slice(-TAIL_LINES).map((l) => l.replace(BOX, '').trim())
  let q = -1
  for (let i = lines.length - 1; i >= 0 && q < 0; i--) if (QUESTION.test(lines[i])) q = i
  if (q >= 0) {
    const options: Dialog['options'] = []
    let end = q
    for (let i = q + 1; i < lines.length; i++) {
      const m = OPTION.exec(lines[i])
      if (m) {
        options.push({ key: m[1], label: m[2] })
        end = i
      } else if (lines[i] && options.length) break
    }
    if (options.length >= 2) {
      let h = -1
      let tool = 'unknown'
      for (let i = q - 1; i >= 0 && h < 0; i--) {
        const hit = TOOLS.find(([re]) => re.test(lines[i]))
        if (hit) [h, tool] = [i, hit[1]]
      }
      const command = h >= 0 ? lines.slice(h + 1, q).find(Boolean) || '' : ''
      return { tool, command, options, text: lines.slice(h >= 0 ? h : q, end + 1).join('\n') }
    }
  }
  const ask = [...lines].reverse().find((l) => ASK.test(l))
  return ask ? { tool: 'ask', command: ask, options: ASK_OPTIONS, text: ask } : null
}

const parsed = new Map<string, Dialog | null>()
let pending = new Map<string, { approval: Approval; agent: Agent; text: string }>()

export async function readDialog(agent: Agent): Promise<Dialog | null> {
  const tail = await readTail(agent, TAIL_LINES)
  const key = shortHash(tail)
  if (!parsed.has(key)) {
    if (parsed.size > 200) parsed.clear()
    parsed.set(key, parseDialog(tail))
  }
  return parsed.get(key) ?? null
}

const sendable = (a: Agent): boolean => {
  try {
    addressOf(a)
    return true
  } catch {
    return false
  }
}

/** Pending prompts of waiting agents; tails are read only for those, and parses are cached per screen. */
export async function approvalsFor(agents: Agent[]): Promise<Approval[]> {
  rememberAgents(agents)
  const waiting = agents.filter((a) => a.state === 'waiting' && sendable(a))
  const dialogs = await Promise.all(waiting.map((a) => readDialog(a).catch(() => null)))
  const next = new Map<string, { approval: Approval; agent: Agent; text: string }>()
  waiting.forEach((agent, i) => {
    const d = dialogs[i]
    if (!d) return
    const id = shortHash(agent.id + d.text)
    const receivedAt = pending.get(id)?.approval.receivedAt ?? Date.now()
    next.set(id, { agent, text: d.text, approval: { id, agentId: agent.id, tool: d.tool, command: d.command, options: d.options, receivedAt, screenHash: shortHash(d.text) } })
  })
  pending = next
  return [...next.values()].map((p) => p.approval)
}

export const pendingApproval = (id: string): { approval: Approval; agent: Agent; text: string } | undefined => pending.get(id)
