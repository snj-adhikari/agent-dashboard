import type { EngineInterface as Engine, On, PluginOptions } from 'claude-code'
import type { RegistryRow } from './balances'
import { biasCheck } from './bias'
import { refreshStatus } from './reminder'
import { canGive, givenToday, parentMap, resolveRank, rubricCeiling } from './chain'
import { REFUSED_FILE, append, appendLine, identity, ledgerDir, newId, read, readLines, ruleFor, stateDir } from './ledger'

export const GIVE_TOOL = 'points_give'
export const GIVE_TOOL_FULL = `mcp__demerits__${GIVE_TOOL}`
const KINDS = ['task', 'hook-block', 'qa', 'snj-correction']

type Evidence = { kind: string; ref: string; detail?: string }
type GiveCall = { target?: string; points?: number; reason?: string; evidence?: Partial<Evidence>; agentId?: string }

export async function toolSessionStart<E>($: Engine, e: E, next: (e: E) => unknown, _cfg: PluginOptions): Promise<unknown> {
  await $.tool.register({
    name: GIVE_TOOL,
    description: 'Give points to an agent below you in the chain of command. Needs evidence. The amount is capped by the rubric for the reason and a daily limit per target. Positive for a merit, negative for a demerit.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Codename of the agent to score.' },
        points: { type: 'number', description: 'Non-zero whole number; negative for a demerit.' },
        reason: { type: 'string', description: 'Short reason; it decides the rubric rule.' },
        evidence: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: KINDS },
            ref: { type: 'string', description: 'Task id, hook rule, QA run or correction the points rest on.' },
            detail: { type: 'string' },
          },
          required: ['kind', 'ref'],
        },
      },
      required: ['target', 'points', 'reason', 'evidence'],
    },
    isDeferred: false,
  })
  return next(e)
}

async function refuse($: Engine, cfg: PluginOptions, caller: string, e: GiveCall, reason: string): Promise<{ deny: string }> {
  const row = { ts: await $.clock.now(), session: await $.session.id(), agent: caller, tool: GIVE_TOOL, target: e.target, points: e.points, reason: e.reason, evidence: e.evidence, refused: reason }
  await appendLine($, `${await ledgerDir($, cfg)}/${REFUSED_FILE}`, row).catch(() => undefined)
  return { deny: `${GIVE_TOOL} refused: ${reason}. Logged to ${REFUSED_FILE}.` }
}

export async function give($: Engine, cfg: PluginOptions, e: GiveCall): Promise<{ deny: string } | { result: string }> {
  const caller = await identity($)
  if (e.agentId) return refuse($, cfg, caller, e, 'subagents cannot give points')
  const target = typeof e.target === 'string' ? e.target.trim().replace(/^@/, '') : ''
  const reason = typeof e.reason === 'string' ? e.reason.trim() : ''
  const ev = e.evidence
  if (!ev || !KINDS.includes(String(ev.kind)) || typeof ev.ref !== 'string' || !ev.ref.trim()) {
    return refuse($, cfg, caller, e, 'evidence needs a kind and a ref')
  }
  if (!target || !reason) return refuse($, cfg, caller, e, 'target and reason are required')
  const points = e.points as number
  const now = await $.clock.now()
  const [events, callerRank, parents, registry] = await Promise.all([
    read($, cfg),
    resolveRank($),
    parentMap($),
    readLines<RegistryRow>($, `${await stateDir($)}/agents.jsonl`),
  ])
  const rule = ruleFor(reason, [...new Set(events.map(x => x.rule))])
  const ceiling = rubricCeiling(rule, Math.sign(points))
  const verdict = canGive({
    giver: caller,
    giverRank: callerRank,
    target,
    targetRank: registry.findLast(r => r.agent === target)?.rank ?? 'sub',
    parentOf: child => parents.get(child),
    points,
    now,
    givenToday: givenToday(events, caller, target, now),
    rubricCeiling: ceiling,
  })
  if (!verdict.ok) return refuse($, cfg, caller, e, verdict.reason)
  const [branch, top] = await Promise.all(
    [['git', 'rev-parse', '--abbrev-ref', 'HEAD'], ['git', 'rev-parse', '--show-toplevel']].map(argv =>
      $.process.run(argv).then(r => (r.exitCode === 0 ? r.stdout.trim() : '')).catch(() => ''),
    ),
  )
  const row = await append($, cfg, {
    id: await newId($),
    ts: now,
    session: await $.session.id(),
    agent: target,
    repo: top.split('/').pop() ?? '',
    branch,
    points,
    rule,
    reason,
    evidence: { ...ev, kind: ev.kind, ref: ev.ref },
    source: 'agent',
    by: caller,
    scope: 'agent',
    rank: callerRank,
  } as never)
  await biasCheck($, cfg, caller).catch(() => undefined)
  await refreshStatus($, cfg)
  return { result: `Logged ${points > 0 ? '+' : ''}${points} for ${target}: ${rule} (${row.id}). Rubric amount suggested: ${ceiling}.` }
}

export function install(on: On, cfg: PluginOptions): void {
  on('tool.call', { tool: GIVE_TOOL_FULL }, async ($, call) => give($, cfg, call as unknown as GiveCall))
}
