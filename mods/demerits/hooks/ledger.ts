import type { EngineInterface as Engine, PluginOptions } from 'claude-code'

export type Source = 'snj' | 'hook' | 'agent' | 'auto'
export type Scope = 'agent' | 'pool'

export type LedgerEvent = {
  id: string
  ts: number
  session: string
  agent: string
  repo: string
  branch: string
  points: number
  rule: string
  reason: string
  evidence: { lastTool?: string; lastAssistant?: string; [key: string]: unknown }
  source: Source
  by: string
  scope: Scope
  reverses?: string
  rank?: string
  biased?: boolean
}

export const DEFAULT_LEDGER_DIR = '~/.claude/demerits'
export const STATE_DIR = '~/.claude/demerits-state'
export const LEDGER_FILE = 'ledger.jsonl'
export const REFUSED_FILE = 'refused.jsonl'
const EVIDENCE_MAX = 300

export const RULES: readonly { slug: string; match: RegExp }[] = [
  { slug: 'commit-without-ask', match: /\bcommit\w*\b.*\b(without|no|never|didn'?t|did not)\b.*\bask/i },
  { slug: 'push-without-ask', match: /\bpush\w*\b.*\b(without|no|never|didn'?t|did not)\b.*\bask|\bpush gate\b/i },
  { slug: 'tamper', match: /\btamper/i },
  { slug: 'comment-style', match: /\bcomment[- ]style\b|\bstacked comments?\b/i },
  { slug: 'attribution', match: /\battribution\b|\bco-authored-by\b/i },
  { slug: 'signature-bypass', match: /\bsignature\b|\bcrafted-by\b|\bsigned-off-by\b/i },
  { slug: 'not-doing-work', match: /\bstopped short\b|\bhanded (it|work) back\b|\bnothing to show\b|\bclaimed done\b|\bnot doing (the )?work\b|\bdidn'?t do (the )?work\b/i },
  { slug: 'ignored-stop', match: /\bignored (a |the )?(stop|halt)\b|\bkept (going|working) after\b.*\b(stop|halt)\b/i },
  { slug: 'unapproved-git', match: /\bunapproved\b|\b(merge|pr|git)\b.*\bwithout (approval|a yes|asking)\b/i },
  { slug: 'guard-bypass', match: /\bbypass\w*\b|\bworked around\b.*\b(hook|guard)\b|\b(hook|guard)\b.*\bworked around\b/i },
  { slug: 'over-explaining', match: /\bover[- ]?explain\w*|\bpadded\b|\btoo long\b|\bverbose\b|\bwall of text\b/i },
  { slug: 'wrong-scope', match: /\bwrong scope\b|\bout of scope\b|\bscope creep\b|\bdidn'?t ask for\b|\bnot asked for\b/i },
  { slug: 'first-time-right', match: /\bfirst time right\b|\bright (the )?first time\b|\bfirst[- ]time[- ]right\b/i },
  { slug: 'followed-guards', match: /\bfollowed (the )?(guards?|hooks?)\b|\brespected (the )?(guards?|hooks?)\b/i },
  { slug: 'short-and-clear', match: /\bshort and clear\b|\bconcise\b|\bclear and short\b/i },
]

export const slugify = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 6).join('-') || 'unspecified'

export function ruleFor(reason: string, known: readonly string[] = []): string {
  const seeded = RULES.find(r => r.match.test(reason))
  if (seeded) return seeded.slug
  const words = new Set(slugify(reason).split('-'))
  return known.find(k => k.split('-').every(w => words.has(w))) ?? slugify(reason)
}

export const clip = (text: string | undefined, max = EVIDENCE_MAX): string | undefined =>
  text === undefined ? undefined : text.length > max ? text.slice(0, max) : text

async function home($: Engine): Promise<string> {
  return (await $.env.get('HOME')) ?? ''
}

export const expandHome = (path: string, home: string): string =>
  path === '~' || path.startsWith('~/') ? `${home}${path.slice(1)}` : path

export function resolveLedgerDir(cfg: PluginOptions, home: string): string {
  const dir = typeof cfg.ledgerDir === 'string' && cfg.ledgerDir.trim() ? cfg.ledgerDir.trim() : DEFAULT_LEDGER_DIR
  return expandHome(dir, home).replace(/\/+$/, '')
}

export async function ledgerDir($: Engine, cfg: PluginOptions): Promise<string> {
  return resolveLedgerDir(cfg, await home($))
}

export async function stateDir($: Engine): Promise<string> {
  return expandHome(STATE_DIR, await home($))
}

export async function writeAtomic($: Engine, path: string, text: string): Promise<void> {
  const tmp = `${path}.${(await $.clock.now()).toString(36)}.${Math.random().toString(36).slice(2, 8)}.tmp`
  await $.fs.write(tmp, text)
  const mv = await $.process.run(['mv', '-f', tmp, path])
  if (mv.exitCode !== 0) throw new Error(`demerits: cannot write ${path}: ${mv.stderr.trim()}`)
}

async function readText($: Engine, path: string): Promise<string> {
  return (await $.fs.exists(path)) ? ((await $.fs.read(path)) as string) : ''
}

export const parseLines = <T>(text: string): T[] =>
  text.split('\n').flatMap(line => {
    if (!line.trim()) return []
    try {
      return [JSON.parse(line) as T]
    } catch {
      return []
    }
  })

export async function readLines<T>($: Engine, path: string): Promise<T[]> {
  return parseLines<T>(await readText($, path))
}

const APPEND_SH = 'line=$1; file=$2; shift 2; mkdir -p "$(dirname "$file")" "$@" && printf "%s\\n" "$line" >> "$file"'

export const appendArgv = (path: string, row: unknown, dirs: readonly string[] = []): string[] =>
  ['/bin/sh', '-c', APPEND_SH, 'sh', JSON.stringify(row), path, ...dirs]

export async function appendLine($: Engine, path: string, row: unknown, dirs: readonly string[] = []): Promise<void> {
  const r = await $.process.run(appendArgv(path, row, dirs))
  if (r.exitCode !== 0) throw new Error(`demerits: cannot append to ${path}: ${r.stderr.trim()}`)
}

export async function read($: Engine, cfg: PluginOptions): Promise<LedgerEvent[]> {
  return readLines<LedgerEvent>($, `${await ledgerDir($, cfg)}/${LEDGER_FILE}`)
}

export const normalise = (event: LedgerEvent): LedgerEvent => ({
  ...event,
  evidence: { ...event.evidence, lastAssistant: clip(event.evidence.lastAssistant) },
})

export async function append($: Engine, cfg: PluginOptions, event: LedgerEvent): Promise<LedgerEvent> {
  const row = normalise(event)
  await appendLine($, `${await ledgerDir($, cfg)}/${LEDGER_FILE}`, row, [await stateDir($)])
  return row
}

export async function newId($: Engine): Promise<string> {
  return `${(await $.clock.now()).toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export const identityOf = (codename: string | undefined, session: string): string => codename?.trim() || session

export async function identity($: Engine): Promise<string> {
  const session = await $.session.id()
  const terminal = await $.env.get('HC_TERMINAL_ID')
  if (!terminal) return session
  try {
    const r = await $.process.run(['hc', 'get', terminal, '--json'])
    const name = (JSON.parse(r.stdout) as { labels?: { codename?: unknown } }).labels?.codename
    return identityOf(r.exitCode === 0 && typeof name === 'string' ? name : undefined, session)
  } catch {
    return session
  }
}
