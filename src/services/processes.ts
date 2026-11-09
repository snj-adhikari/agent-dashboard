import path from 'path'
import { sh, watchDirs } from '../utils'
import { reportedByPid } from './hooks/sessions'
import type { AgentProcess } from '../types'

const AGENT_BINARIES = 'claude|copilot|codex|antigravity|agentastic'
const SCAN_TTL_MS = 5000

type ScannedAgent = AgentProcess & { inHerdr: boolean }

let scan: { at: number; agents: ScannedAgent[] } | null = null

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

/** `ps eww` appends each process's env to its command, so herdr panes show HERDR_PANE_ID and Herdr app terminals HC_TERMINAL_ID. */
export function herdrOwnedPids(psOut: string): Set<string> {
  return new Set(
    psOut
      .split('\n')
      .map((line) => line.match(/^\s*(\d+)\s.*\b(?:HERDR_PANE_ID=w\d+:p\d+|HC_TERMINAL_ID=t[0-9a-z]+)\b/)?.[1])
      .filter((pid): pid is string => !!pid)
  )
}

/**
 * Every agent process, flagged when it runs in a herdr pane. pgrep finds the live pids; those whose plugin already reported (pid, cwd, session id)
 * skip the slow lsof and ps lookups, and the rest are scanned with one call each. Cached briefly since it blocks the event loop.
 */
function scanAgents(): ScannedAgent[] {
  if (scan && Date.now() - scan.at < SCAN_TTL_MS) return scan.agents
  const pids = sh(`pgrep -x '${AGENT_BINARIES}'`).split('\n').filter(Boolean)
  const owned = pids.length ? herdrOwnedPids(sh(`ps eww -p ${pids.join(',')} -o pid=,command=`)) : new Set<string>()
  let agents: ScannedAgent[] = []
  if (pids.length) {
    const reported = reportedByPid()
    const unknown = pids.filter((pid) => !reported.has(pid))
    const cwds = unknown.length ? cwdsOf(unknown) : new Map<string, string>()
    const comms = unknown.length ? psFields(unknown, 'comm') : new Map<string, string>()
    const args = unknown.length ? psFields(unknown, 'args') : new Map<string, string>()
    agents = pids.map((pid) => {
      const r = reported.get(pid)
      const inHerdr = owned.has(pid)
      if (r) return { pid, cmd: 'claude', cwd: r.cwd, sessionId: r.sessionId, inHerdr }
      return { pid, cmd: path.basename(comms.get(pid) || ''), cwd: cwds.get(pid) || '', sessionId: sessionIdOf(args.get(pid) || ''), inHerdr }
    })
  }
  scan = { at: Date.now(), agents }
  return agents
}

/** Bare agents only; processes inside herdr panes are listed by the herdr source. */
export function agentProcesses(): AgentProcess[] {
  return scanAgents()
    .filter((a) => !a.inHerdr && watchDirs().some((dir) => a.cwd.startsWith(dir)))
    .map(({ inHerdr: _inHerdr, ...a }) => a)
}

/** Cwds of agent processes running in herdr panes, so their worktrees stay protected even when herdr can't be listed. */
export function herdrProcessCwds(): { cwd: string }[] {
  return scanAgents()
    .filter((a) => a.inHerdr && a.cwd)
    .map((a) => ({ cwd: a.cwd }))
}

export function claudeSessionIdForCwd(cwd: string): string | undefined {
  return scanAgents().find((a) => a.cmd === 'claude' && a.cwd === cwd)?.sessionId
}

export function terminateAgent(pid: number): void {
  process.kill(pid, 'SIGTERM')
}
