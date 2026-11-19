import type { EngineInterface as Engine, On, PluginOptions } from 'claude-code'
import { append, appendLine, clip, identity, newId, readLines, stateDir } from './ledger'

export const SEEN_FILE = 'blocks-seen.jsonl'

export const DENY_RULES: readonly { rule: string | null; hook: string; match: RegExp }[] = [
  { rule: null, hook: 'stranger-danger', match: /^stranger-danger:/ },
  { rule: 'push-without-ask', hook: 'push-gate', match: /^git push needs the user's explicit go-ahead/ },
  { rule: 'commit-without-ask', hook: 'push-gate', match: /^git commit needs the user's explicit go-ahead/ },
  { rule: 'tamper', hook: 'push-gate', match: /^Approval grants and relay logs are written only by/ },
  { rule: 'comment-style', hook: 'comment-style-guard', match: /^Comment style: / },
  { rule: 'attribution', hook: 'attribution-guard', match: /attribution/i },
  { rule: 'signature-bypass', hook: 'signature', match: /^Blocked: never skip commit signing or verification/ },
]

export const ruleOfDeny = (text: string): { rule: string; hook: string } | undefined => {
  const hit = DENY_RULES.find(r => r.match.test(text))
  return hit?.rule ? { rule: hit.rule, hook: hit.hook } : undefined
}

const sha256 = async (text: string): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('')

export async function taskKey($: Engine): Promise<string> {
  const session = await $.session.id()
  const file = `${await $.session.cwd()}/ai/factory/task.md`
  return (await $.fs.exists(file)) ? `${session}:${await sha256((await $.fs.read(file)) as string)}` : session
}

const subject = (e: Record<string, unknown>): string => {
  const v = ['command', 'file_path', 'notebook_path', 'path'].map(k => e[k]).find(x => typeof x === 'string')
  return typeof v === 'string' ? v : ''
}

async function gitOut($: Engine, argv: string[]): Promise<string> {
  try {
    const r = await $.process.run(argv)
    return r.exitCode === 0 ? r.stdout.trim() : ''
  } catch {
    return ''
  }
}

export async function logBlock($: Engine, cfg: PluginOptions, e: Record<string, unknown>, denyText: string): Promise<void> {
  const hit = ruleOfDeny(denyText)
  if (!hit) return
  const target = subject(e)
  const task = await taskKey($)
  const key = await sha256(`${task}\n${e.tool}\n${target}`)
  const state = await stateDir($)
  const seenPath = `${state}/${SEEN_FILE}`
  if ((await readLines<{ key: string }>($, seenPath)).some(r => r.key === key)) return
  await appendLine($, seenPath, { key, ts: await $.clock.now() }, [state])
  const [branch, top] = await Promise.all([gitOut($, ['git', 'rev-parse', '--abbrev-ref', 'HEAD']), gitOut($, ['git', 'rev-parse', '--show-toplevel'])])
  await append($, cfg, {
    id: await newId($),
    ts: await $.clock.now(),
    session: await $.session.id(),
    agent: await identity($),
    repo: top.split('/').pop() ?? '',
    branch,
    points: -1,
    rule: hit.rule,
    reason: `Hook block: ${hit.rule}`,
    evidence: { tool: e.tool, [e.tool === 'Bash' ? 'command' : 'path']: clip(target, 200), hook: hit.hook, denyText: clip(denyText, 200), task },
    source: 'hook',
    by: 'hook',
    scope: 'agent',
  })
}

export async function blocksToolCall($: Engine, e: Record<string, unknown>, next: (e: never) => Promise<{ deny?: string }> | { deny?: string }, cfg: PluginOptions) {
  const ran = await next(e as never)
  if (typeof ran?.deny === 'string') await logBlock($, cfg, e, ran.deny).catch(() => undefined)
  return ran
}

export function install(_on: On, _cfg: PluginOptions): void {}
