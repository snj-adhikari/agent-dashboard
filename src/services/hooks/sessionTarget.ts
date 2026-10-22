import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { cmuxWorkspaces } from '../cmux'
import { HOOK_TAB_PREFIX } from './types'

const CONTEXT_LIMIT_PCT = 50
const STALE_AFTER_S = 15 * 60
const TAIL_BYTES = 256 * 1024
const SESSION_ID_RE = /^[A-Za-z0-9-]+$/
const CLAUDE_DIR = path.join(os.homedir(), '.claude')

export interface SessionUsage {
  ref: string
  pct: number | null
}

export type SessionTarget = { kind: 'send'; ref: string; pct: number } | { kind: 'open' } | { kind: 'defer'; reason: string }

/** No live session opens a new tab; otherwise the lowest-context session under the limit, or defer. */
export function pickSessionTarget(sessions: SessionUsage[]): SessionTarget {
  if (!sessions.length) return { kind: 'open' }
  const [best] = sessions
    .filter((s): s is { ref: string; pct: number } => s.pct !== null && s.pct < CONTEXT_LIMIT_PCT)
    .sort((a, b) => a.pct - b.pct)
  if (best) return { kind: 'send', ref: best.ref, pct: best.pct }
  return { kind: 'defer', reason: `all ${sessions.length} live session(s) at ≥${CONTEXT_LIMIT_PCT}% context or unknown` }
}

interface TranscriptEntry {
  type?: string
  isSidechain?: boolean
  message?: {
    model?: string
    usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
  }
}

export function usagePctFromJsonl(text: string): number | null {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry: TranscriptEntry
    try {
      entry = JSON.parse(lines[i])
    } catch {
      continue
    }
    const usage = entry.type === 'assistant' && !entry.isSidechain ? entry.message?.usage : undefined
    if (!usage) continue
    const tokens = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0)
    if (!tokens) continue
    // ponytail: window guessed from a "[1m]" model id or >200k usage, else 200k; read the real window if the transcript ever records it
    const window = (entry.message?.model || '').includes('[1m]') || tokens > 200_000 ? 1_000_000 : 200_000
    return Math.round((tokens / window) * 100)
  }
  return null
}

function readTail(file: string): string {
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    const len = Math.min(size, TAIL_BYTES)
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, size - len)
    return buf.toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

function statuslinePct(sessionId: string): number | null {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(CLAUDE_DIR, 'context-state', `${sessionId}.json`), 'utf8'))
    const fresh = Date.now() / 1000 - Number(state.updated_at) <= STALE_AFTER_S
    return fresh && typeof state.used_percentage === 'number' ? state.used_percentage : null
  } catch {
    return null
  }
}

function transcriptPct(sessionId: string, cwd: string): number | null {
  try {
    return usagePctFromJsonl(readTail(path.join(CLAUDE_DIR, 'projects', cwd.replace(/[^A-Za-z0-9-]/g, '-'), `${sessionId}.jsonl`)))
  } catch {
    return null
  }
}

export function contextPct(sessionId: string, cwd: string): number | null {
  if (!SESSION_ID_RE.test(sessionId)) return null
  return statuslinePct(sessionId) ?? transcriptPct(sessionId, cwd)
}

function worktreeRoots(repoPath: string): string[] {
  const out = execFileSync('git', ['-C', repoPath, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' })
  return out
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice(9).toLowerCase())
}

/** Live, non-hook Claude tabs whose cwd is inside the repo or one of its worktrees. */
export function repoSessions(repoPath: string): SessionUsage[] {
  const roots = worktreeRoots(repoPath)
  return cmuxWorkspaces()
    .filter((t) => {
      // macOS paths are case-insensitive and a repo directory can be reached under either casing
      const cwd = t.cwd.toLowerCase()
      return t.sessionId && !t.title.startsWith(HOOK_TAB_PREFIX) && roots.some((r) => cwd === r || cwd.startsWith(`${r}/`))
    })
    .map((t) => ({ ref: t.ref, pct: contextPct(t.sessionId as string, t.cwd) }))
}
