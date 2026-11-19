import { readTail, rememberAgents } from './keys'
import { normalise, shortHash } from './relayLog'
import type { Agent, Reply } from './agents'
import { parseDialog } from './promptParse'

const REPLY_TAIL = 60
const MAX_STORED = 200
const sentTo = new Set<string>()
const store = new Map<string, Reply>()

export const noteSent = (agentId: string): void => void sentTo.add(agentId)

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** `<codename> here: ...` lines, with Claude's `⏺` marker stripped and indented wrap lines joined back on. */
export function parseReplies(tail: string, codename: string): string[] {
  const start = new RegExp(`^\\s*(?:⏺\\s*)?${escape(codename)} here:\\s*(.*)$`, 'i')
  const lines = tail.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = start.exec(lines[i])
    if (!m) continue
    const parts = [m[1]]
    while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !/^\s*[⏺❯>│─]/.test(lines[i + 1])) parts.push(lines[++i])
    const text = normalise(parts.join(' '))
    if (text) out.push(text)
  }
  return out
}

const ASK_START = /^\s*(?:[❯>]\s*)?(?:Hey [\w-]+, )?([\w-]+(?: lead)?) (?:here:\s*(.*\bASK\b.*)|needs your approval:?\s*(.*))$/

/** Sub-agent asks typed into a main's pane (`<name> here: ... ASK ...`, `<name> needs your approval: ...`), wrap lines joined back on. */
export function parseAsks(tail: string, codename: string): { from: string; text: string }[] {
  const lines = tail.split('\n')
  const out: { from: string; text: string }[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = ASK_START.exec(lines[i])
    if (!m || m[1].toLowerCase() === codename.toLowerCase()) continue
    const parts = [m[2] ?? m[3]]
    while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !/^\s*[⏺❯>│─]/.test(lines[i + 1])) parts.push(lines[++i])
    const text = normalise(parts.join(' '))
    if (text) out.push({ from: m[1], text })
  }
  return out
}

const keep = (r: Reply): void => void (store.has(r.id) || store.set(r.id, r))

/** Replies from agents the panel has sent to and sub-agent asks seen by mains, de-duplicated by hash and stamped when first seen. */
export async function repliesFor(agents: Agent[]): Promise<Reply[]> {
  rememberAgents(agents)
  const live = agents.filter((a) => (sentTo.has(a.id) || a.isMain) && a.codename && a.host !== 'bare')
  const tails = await Promise.all(live.map((a) => readTail(a, REPLY_TAIL).catch(() => '')))
  live.forEach((agent, i) => {
    const codename = agent.codename as string
    if (sentTo.has(agent.id)) for (const text of parseReplies(tails[i], codename)) keep({ id: shortHash(agent.id + text), agentId: agent.id, codename, text, at: Date.now(), kind: 'reply', from: null })
    const dialog = agent.isMain && agent.state === 'waiting' ? normalise(parseDialog(tails[i])?.text || '') : ''
    if (agent.isMain) for (const a of parseAsks(tails[i], codename)) if (!dialog || !dialog.includes(a.text.slice(0, 40))) keep({ id: shortHash(agent.id + a.from + a.text), agentId: agent.id, codename, text: a.text, at: Date.now(), kind: 'ask', from: a.from })
  })
  while (store.size > MAX_STORED) store.delete(store.keys().next().value as string)
  const ids = new Set(agents.map((a) => a.id))
  return [...store.values()].filter((r) => ids.has(r.agentId))
}
