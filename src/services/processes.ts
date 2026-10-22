import path from 'path'
import { sh, watchDirs } from '../utils'
import { reportedByPid } from './hooks/sessions'
import type { AgentProcess } from '../types'

const AGENT_BINARIES = 'claude|copilot|codex|antigravity|agentastic'
const SCAN_TTL_MS = 5000

let scan: { at: number; agents: AgentProcess[] } | null = null

function sessionIdOf(args: string): string | undefined {
  return args.match(/--(?:session-id|resume)[= ]([0-9a-f-]{36})/)?.[1]
}

/** lsof is slow on macOS (~1s per call), so cwds for all pids come from one call. */
export function parseLsofCwds(out: string): Map<string, string> {
  const cwds = new Map<string, string>()
  let pid = ''
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = line.slice(1)
    else if (line.startsWith('n') && pid) cwds.set(pid, line.slice(1))
  }
  return cwds
}

function cwdsOf(pids: string[]): Map<string, string> {
  return parseLsofCwds(sh(`lsof -a -p ${pids.join(',')} -d cwd -Fpn 2>/dev/null`))
}

function psFields(pids: string[], field: 'comm' | 'args'): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of sh(`ps -p ${pids.join(',')} -o pid=,${field}=`).split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.*)$/)
    if (m) out.set(m[1], m[2])
  }
  return out
}

/**
 * Every agent process. pgrep finds the live pids; those whose plugin already reported (pid, cwd, session id)
 * skip the slow lsof and ps lookups, and the rest are scanned with one call each. Cached briefly since it blocks the event loop.
 */
function scanAgents(): AgentProcess[] {
  if (scan && Date.now() - scan.at < SCAN_TTL_MS) return scan.agents
  const pids = sh(`pgrep -x '${AGENT_BINARIES}'`).split('\n').filter(Boolean)
  let agents: AgentProcess[] = []
  if (pids.length) {
    const reported = reportedByPid()
    const unknown = pids.filter((pid) => !reported.has(pid))
    const cwds = unknown.length ? cwdsOf(unknown) : new Map<string, string>()
    const comms = unknown.length ? psFields(unknown, 'comm') : new Map<string, string>()
    const args = unknown.length ? psFields(unknown, 'args') : new Map<string, string>()
    agents = pids.map((pid) => {
      const r = reported.get(pid)
      if (r) return { pid, cmd: 'claude', cwd: r.cwd, sessionId: r.sessionId }
      return { pid, cmd: path.basename(comms.get(pid) || ''), cwd: cwds.get(pid) || '', sessionId: sessionIdOf(args.get(pid) || '') }
    })
  }
  scan = { at: Date.now(), agents }
  return agents
}

export function agentProcesses(): AgentProcess[] {
  return scanAgents().filter((a) => watchDirs().some((dir) => a.cwd.startsWith(dir)))
}

export function claudeSessionIdForCwd(cwd: string): string | undefined {
  return scanAgents().find((a) => a.cmd === 'claude' && a.cwd === cwd)?.sessionId
}

export function terminateAgent(pid: number): void {
  process.kill(pid, 'SIGTERM')
}
