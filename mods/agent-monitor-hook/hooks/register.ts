import type { EngineInterface, Register } from 'claude-code'

const DEFAULT_URL = 'http://localhost:5818'
const PR_COMMAND = /\bgh\s+pr\s+create\b/

interface Report {
  sessionId: string
  phase: string
  pid?: string
  cwd?: string
  workspace?: string
  hook?: string
  ticket?: string
  branch?: string
}

async function report($: EngineInterface, base: string, state: Report): Promise<void> {
  await $.http.fetch(`${base}/api/hook-session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) }).catch(() => undefined)
}

export const register: Register = (on) => {
  let interactive = false
  let cwd: string | undefined
  let pid: string | undefined
  let workspace: string | undefined
  let ticket: string | undefined
  let branch: string | undefined
  let hook: string | undefined
  let base = DEFAULT_URL
  let phase = 'working'

  on('session.start', async ($, e, next) => {
    interactive = e.isInteractive
    cwd = e.cwd
    pid = await $.env.get('CMUX_CLAUDE_PID')
    workspace = await $.env.get('CMUX_WORKSPACE_ID')
    ticket = await $.env.get('AGENT_MONITOR_TICKET')
    branch = await $.env.get('AGENT_MONITOR_BRANCH')
    hook = await $.env.get('AGENT_MONITOR_HOOK')
    base = (await $.env.get('AGENT_MONITOR_URL')) || DEFAULT_URL
    if (ticket) $.ui.status(`${ticket} · ${branch ?? ''} · ${phase}`)
    if (interactive) await report($, base, { sessionId: await $.session.id(), phase, pid, cwd, workspace, hook, ticket, branch })
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (interactive && PR_COMMAND.test(e.command) && ran.deny === undefined && ran.isError !== true) {
      phase = 'pr-opened'
      if (ticket) $.ui.status(`${ticket} · ${phase}`)
      await report($, base, { sessionId: await $.session.id(), phase, pid, cwd, workspace, hook, ticket, branch })
    }
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (interactive && phase !== 'pr-opened') {
      phase = 'awaiting-you'
      if (ticket) $.ui.status(`${ticket} · ${phase}`)
      await report($, base, { sessionId: await $.session.id(), phase, pid, cwd, workspace, hook, ticket, branch })
    }
    return next(e)
  })
}
