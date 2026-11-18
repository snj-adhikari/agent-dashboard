import { readTail, rememberAgents } from './keys'
import { normalise, shortHash } from './relayLog'
import type { Agent, Reply } from './agents'

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

/** Replies from agents the panel has sent to, de-duplicated by hash and stamped when first seen. */
export async function repliesFor(agents: Agent[]): Promise<Reply[]> {
  rememberAgents(agents)
  const live = agents.filter((a) => sentTo.has(a.id) && a.codename && a.host !== 'bare')
  const tails = await Promise.all(live.map((a) => readTail(a, REPLY_TAIL).catch(() => '')))
  live.forEach((agent, i) => {
    for (const text of parseReplies(tails[i], agent.codename as string)) {
      const id = shortHash(agent.id + text)
      if (!store.has(id)) store.set(id, { id, agentId: agent.id, codename: agent.codename as string, text, at: Date.now() })
    }
  })
  while (store.size > MAX_STORED) store.delete(store.keys().next().value as string)
  const ids = new Set(agents.map((a) => a.id))
  return [...store.values()].filter((r) => ids.has(r.agentId))
}
