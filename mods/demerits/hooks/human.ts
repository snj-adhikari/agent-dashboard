import type { EngineInterface as Engine } from 'claude-code'

const RELAY_TAG = /^\s*\[(subtab|main |monitor\]|agents\]|hook:|relay )/

const sha256 = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text.replace(/\s+/g, ' ').trim())))].map(b => b.toString(16).padStart(2, '0')).join('')

async function loggedAsRelay($: Engine, text: string): Promise<boolean> {
  try {
    const [home, hc, session, pane, cmux, run] = await Promise.all([$.env.get('HOME'), $.env.get('HC_TERMINAL_ID'), $.env.get('HERDR_SESSION'), $.env.get('HERDR_PANE_ID'), $.env.get('CMUX_SURFACE_ID'), $.env.get('AGENT_SUBTAB_ID')])
    const keys = [hc, session && pane ? `${session}-${pane}` : '', cmux, run ? `sub-${run}` : ''].filter(Boolean).map(k => String(k).replace(/[^\w.:-]/g, '_'))
    const digests = new Set(await Promise.all([text, ...text.split('\n').filter(l => l.trim())].map(sha256)))
    for (const k of keys) {
      const file = `${home}/.claude/agent-relays/${k}.jsonl`
      if (!(await $.fs.exists(file))) continue
      for (const line of ((await $.fs.read(file)) as string).split('\n')) {
        try {
          if (digests.has((JSON.parse(line) as { sha256?: string }).sha256 ?? '')) return true
        } catch {
          continue
        }
      }
    }
  } catch {
    return false
  }
  return false
}

export async function isHumanPrompt($: Engine, p: { origin?: { kind?: string }; text: string }): Promise<boolean> {
  if (p.origin?.kind !== 'composer' && p.origin?.kind !== 'bridge') return false
  if (RELAY_TAG.test(p.text)) return false
  return !(await loggedAsRelay($, p.text))
}
