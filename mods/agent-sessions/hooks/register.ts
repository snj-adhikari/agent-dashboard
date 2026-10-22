import type { Register } from 'claude-code'
import { formatSessions, type MonitorState } from './tree'

const DEFAULT_URL = 'http://localhost:5818'

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'agent-sessions', description: 'Show every Claude session and the worktree it is working in' })
    return next(e)
  })

  on('command.run', { command: 'agent-sessions' }, async ($) => {
    const base = (await $.env.get('AGENT_MONITOR_URL')) || DEFAULT_URL
    try {
      const res = await $.http.fetch(`${base}/api/graph`)
      const body = JSON.parse(res.text) as { state: MonitorState }
      return { text: formatSessions(body.state) }
    } catch {
      return { text: `Could not reach the agent-monitor at ${base}. Is it running?` }
    }
  })
}
