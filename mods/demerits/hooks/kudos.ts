import type { EngineInterface as Engine, On, PluginOptions } from 'claude-code'
import { isHumanPrompt } from './human'
import { append, identity, newId, stateDir, writeAtomic, type LedgerEvent } from './ledger'

type Next = (e: any) => any
type Trigger = 'gh-pr-merge' | 'factory-done' | 'thanks'

export type Counts = { blocks: number; rework: number; redirections: number; humanPrompts: number }
type TaskState = Counts & { prompts: string[]; approved: boolean; awarded: boolean }

const CORRECTIVE = /^\s*no\b|\bwrong\b|\bi said\b|\bnot that\b|\bthat'?s not\b/i
const REWORK = /\b(redo|again|reopen)\b/i
const THANKS = /\b(thanks|thank you|looks good|lgtm)\b/i
const APPROVAL = /\b(approved?|go ahead|ship it|yes)\b/i
const GH_MERGE = /\bgh\s+pr\s+merge\b/
const FACTORY_DONE = /FACTORY:\s*DONE\s*$/
const FACTORY_CONTINUE = /FACTORY:\s*CONTINUE/
const QA_GAPS = /\b(gaps?|qa)\b/i
const SIMILAR = 0.85
const MIN_WORDS = 3
const PROMPT_MEMORY = 50

export const HEURISTICS =
  'redirection: human prompt starting with "no" or containing wrong / I said / not that / that\'s not, or near-identical (word overlap >= 0.85) to an earlier prompt; rework: human prompt containing redo / again / reopen, or a FACTORY: CONTINUE answer mentioning QA or gaps; blocks: tool calls denied'

const fresh = (): TaskState => ({ blocks: 0, rework: 0, redirections: 0, humanPrompts: 0, prompts: [], approved: false, awarded: false })

export function score(c: Counts): { points: number; parts: Record<string, number> } {
  const parts = {
    blocks: c.blocks === 0 ? 5 : 0,
    rework: c.rework === 0 ? 5 : 0,
    redirections: c.redirections === 0 ? 5 : c.redirections === 1 ? 2 : -(c.redirections - 2),
    humanPrompts: c.humanPrompts <= 3 ? 3 : 0,
  }
  return { points: Object.values(parts).reduce((a, b) => a + b, 0), parts }
}

const words = (text: string): string[] => text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)

export function nearIdentical(a: string, b: string): boolean {
  const x = new Set(words(a))
  const y = new Set(words(b))
  if (x.size < MIN_WORDS || y.size < MIN_WORDS) return false
  const shared = [...x].filter(w => y.has(w)).length
  return shared / (x.size + y.size - shared) >= SIMILAR
}

const sha256 = async (text: string): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('')

export async function taskKey($: Engine): Promise<string> {
  const session = await $.session.id()
  try {
    const file = `${await $.session.cwd()}/ai/factory/task.md`
    if (await $.fs.exists(file)) return `${session}-${(await sha256((await $.fs.read(file)) as string)).slice(0, 12)}`
  } catch {
    return session
  }
  return session
}

async function taskFile($: Engine): Promise<string> {
  return `${await stateDir($)}/tasks/${(await taskKey($)).replace(/[^\w.-]/g, "_")}.json`
}

async function load($: Engine, path: string): Promise<TaskState> {
  if (!(await $.fs.exists(path))) return fresh()
  try {
    return { ...fresh(), ...(JSON.parse((await $.fs.read(path)) as string) as Partial<TaskState>) }
  } catch {
    return fresh()
  }
}

async function save($: Engine, path: string, state: TaskState): Promise<void> {
  await $.process.run(['mkdir', '-p', path.slice(0, path.lastIndexOf('/'))])
  await writeAtomic($, path, JSON.stringify(state))
}

async function gitOut($: Engine, argv: string[]): Promise<string> {
  try {
    const r = await $.process.run(argv)
    return r.exitCode === 0 ? r.stdout.trim() : ''
  } catch {
    return ''
  }
}

async function finish($: Engine, cfg: PluginOptions, path: string, state: TaskState, trigger: Trigger): Promise<void> {
  if (state.awarded) return
  state.awarded = true
  await save($, path, state)
  const counts: Counts = { blocks: state.blocks, rework: state.rework, redirections: state.redirections, humanPrompts: state.humanPrompts }
  const { points, parts } = score(counts)
  const [agent, session, ts, branch, top] = await Promise.all([
    identity($),
    $.session.id(),
    $.clock.now(),
    gitOut($, ['git', 'rev-parse', '--abbrev-ref', 'HEAD']),
    gitOut($, ['git', 'rev-parse', '--show-toplevel']),
  ])
  const evidence: LedgerEvent['evidence'] = { ...counts, trigger, breakdown: parts, taskKey: await taskKey($), heuristics: HEURISTICS }
  const base = { session, agent, repo: top.split('/').pop() ?? '', branch, evidence, source: 'auto', by: 'auto', scope: 'agent' } as const
  await append($, cfg, {
    ...base,
    id: await newId($),
    ts,
    points,
    rule: points < 0 ? 'redirections' : 'good-work',
    reason: `Task finished (${trigger}): ${points > 0 ? '+' : ''}${points}`,
  })
  await append($, cfg, { ...base, id: await newId($), ts, points: 0, rule: 'verified-task', reason: 'Verified task' })
}

export async function kudosPromptSubmit($: Engine, e: any, next: Next, cfg: PluginOptions) {
  try {
    if (!e.command && !e.isMeta && (await isHumanPrompt($, e))) {
      const path = await taskFile($)
      const state = await load($, path)
      const text = String(e.text)
      const thanks = THANKS.test(text)
      if (!(thanks && !state.awarded)) state.humanPrompts += 1
      const redirect = CORRECTIVE.test(text) || state.prompts.some(p => nearIdentical(p, text))
      if (redirect) state.redirections += 1
      if (REWORK.test(text)) state.rework += 1
      if (!redirect && APPROVAL.test(text)) state.approved = true
      state.prompts = [...state.prompts, text].slice(-PROMPT_MEMORY)
      await save($, path, state)
      if (thanks) await finish($, cfg, path, state, 'thanks')
    }
  } catch {
    return next(e)
  }
  return next(e)
}

export async function kudosToolCall($: Engine, e: any, next: Next, cfg: PluginOptions) {
  const ran = await next(e)
  try {
    const denied = ran?.deny !== undefined
    const merged =
      e.tool === 'Bash' && GH_MERGE.test(String(e.command ?? '')) && !denied && ran?.isError !== true && (ran?.result?.exitCode ?? 0) === 0
    if (denied || merged) {
      const path = await taskFile($)
      const state = await load($, path)
      if (denied) {
        state.blocks += 1
        await save($, path, state)
      }
      if (merged) await finish($, cfg, path, state, 'gh-pr-merge')
    }
  } catch {
    return ran
  }
  return ran
}

export async function kudosTurnComplete($: Engine, e: any, next: Next, cfg: PluginOptions) {
  try {
    const answer = String(e.answer ?? '')
    const done = FACTORY_DONE.test(answer.trim())
    const rework = FACTORY_CONTINUE.test(answer) && QA_GAPS.test(answer)
    if (!e.agentId && (done || rework)) {
      const path = await taskFile($)
      const state = await load($, path)
      if (rework) {
        state.rework += 1
        await save($, path, state)
      }
      if (done && state.approved) await finish($, cfg, path, state, 'factory-done')
    }
  } catch {
    return next(e)
  }
  return next(e)
}

export function install(_on: On, _cfg: PluginOptions): void {}
