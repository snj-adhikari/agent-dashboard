import { sh, timeAgo } from '../utils'
import { claudeSessionIdForCwd } from './processes'
import type { CmuxTab } from '../types'

export function cmuxWorkspaces(): CmuxTab[] {
  const raw = sh('cmux workspace list --json')
  if (!raw) return []
  try {
    const data = JSON.parse(raw)
    return data.workspaces.map((w: Record<string, unknown>) => {
      const cwd = String(w.current_directory || '').replace(/\/$/, '')
      return {
        ref: w.ref,
        id: String(w.id || ''),
        cwd,
        title: String(w.custom_title || w.latest_submitted_message || w.latest_conversation_message || '')
          .replace(/\n/g, ' ')
          .slice(0, 60),
        lastActive: timeAgo(w.latest_submitted_at as string | undefined),
        sessionId: claudeSessionIdForCwd(cwd)
      }
    })
  } catch {
    return []
  }
}
