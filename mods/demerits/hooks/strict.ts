import type { EngineInterface as Engine, On, PluginOptions } from 'claude-code'
import { identity, read, type LedgerEvent } from './ledger'

const DAY_MS = 86_400_000

type Guard = { rule: string; tool: RegExp; pattern: RegExp }

export const STRICT_TABLE: readonly Guard[] = [
  { rule: 'commit-without-ask', tool: /^Bash$/, pattern: /\bgit\s+commit\b/ },
  { rule: 'push-without-ask', tool: /^Bash$/, pattern: /\bgit\s+push\b/ },
  { rule: 'tamper', tool: /^Bash$/, pattern: /demerits|agent-orchestration\/(main|runs)|\.cache\/factory/ },
  { rule: 'comment-style', tool: /^(Write|Edit|MultiEdit)$/, pattern: /\.(tsx?|jsx?|php|py|s?css)$/ },
  { rule: 'attribution', tool: /^Bash$/, pattern: /\bgit\s+commit\b|\bgh\s+pr\s+(create|edit)\b/ },
  { rule: 'signature-bypass', tool: /^Bash$/, pattern: /\bgit\s+commit\b[^|;&]*(\s-\w*s\w*\b|--signoff|--no-verify)/ },
  { rule: 'unapproved-git', tool: /^Bash$/, pattern: /\bgit\s+(commit|push|merge)\b|\bgh\s+pr\s+(create|merge)\b/ },
  { rule: 'guard-bypass', tool: /^Bash$/, pattern: /--force\b|\bcore\.hooksPath\b|\bHUSKY=0\b/ },
  { rule: 'wrong-scope', tool: /^(Write|Edit|MultiEdit|NotebookEdit)$/, pattern: /./ },
]

export function strictRules(events: readonly LedgerEvent[], agent: string, now: number, threshold: number, windowDays: number): string[] {
  const span = windowDays * DAY_MS
  const times = new Map<string, number[]>()
  for (const e of events) {
    if (e.agent !== agent || e.scope !== 'agent' || e.points >= 0) continue
    times.set(e.rule, [...(times.get(e.rule) ?? []), e.ts])
  }
  return [...times].flatMap(([rule, ts]) => {
    ts.sort((a, b) => a - b)
    const tripped = ts.some((t, i) => ts.filter((u, j) => j <= i && u > t - span).length >= threshold)
    return tripped && now - ts[ts.length - 1] < span ? [rule] : []
  })
}

const num = (value: unknown, fallback: number): number => {
  const n = Number(value)
  return value !== undefined && value !== '' && Number.isFinite(n) && n > 0 ? n : fallback
}

const textOf = (tool: string, input: unknown): string => {
  const i = (input ?? {}) as Record<string, unknown>
  const text = tool === 'Bash' ? i.command : (i.file_path ?? i.notebook_path)
  return typeof text === 'string' ? text : ''
}

export async function strictToolCheck($: Engine, e: { tool: string; input: unknown }, next: (e: never) => unknown, cfg: PluginOptions) {
  const text = textOf(e.tool, e.input)
  const hits = STRICT_TABLE.filter(g => g.tool.test(e.tool) && g.pattern.test(text))
  if (!hits.length) return next(e as never)
  const threshold = num(cfg.threshold, 3)
  const windowDays = num(cfg.windowDays, 7)
  try {
    const now = await $.clock.now()
    const strict = strictRules(await read($, cfg), await identity($), now, threshold, windowDays)
    const hit = hits.find(g => strict.includes(g.rule))
    if (hit) {
      return { decision: 'ask' as const, reason: `Strict mode: rule "${hit.rule}" has ${threshold}+ demerits for this agent in ${windowDays} days. Confirm before running.` }
    }
  } catch {
    return next(e as never)
  }
  return next(e as never)
}

export function install(_on: On, _cfg: PluginOptions): void {}
