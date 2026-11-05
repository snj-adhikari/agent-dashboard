import { audienceOf, type Identity, type PullRow } from './audience'

export interface Extractor { name: string; test(text: string): boolean; extract(text: string, tool: string): PullRow[] }

type Obj = Record<string, unknown>

const MAX_CHARS = 1_000_000
const NO_OBSERVE = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const WRITING_CALL = /-X\s*(POST|PATCH|PUT|DELETE)\b|--request\s+(POST|PATCH|PUT|DELETE)\b|--method\s+(POST|PATCH|PUT|DELETE)\b|\bcurl\b[^|]*\s(-d|--data\S*)\s|--body\b|(?:-f|-F|--field|--raw-field)\s+body=/i

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const jsonish = (t: string) => /^\s*[{[]/.test(t)

function iso(v: unknown): string {
  const s = str(v)
  if (/^\d{9,11}(\.\d+)?$/.test(s)) return new Date(Number(s) * 1000).toISOString()
  if (/^\d{12,14}$/.test(s)) return new Date(Number(s)).toISOString()
  const d = new Date(s)
  return s && !Number.isNaN(d.getTime()) ? d.toISOString() : ''
}

function adf(node: unknown): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(adf).join('')
  if (!isObj(node)) return ''
  const own = typeof node.text === 'string' ? node.text : ''
  const kids = adf(node.content)
  return own + kids + (node.type === 'paragraph' || node.type === 'hardBreak' ? '\n' : '')
}

function walk(v: unknown, pick: (o: Obj) => PullRow | null, out: PullRow[], depth = 0): void {
  if (depth > 12) return
  if (Array.isArray(v)) return v.forEach((x) => walk(x, pick, out, depth + 1))
  if (!isObj(v)) return
  const row = pick(v)
  if (row) return void out.push(row)
  for (const x of Object.values(v)) walk(x, pick, out, depth + 1)
}

function jsonRows(text: string, pick: (o: Obj) => PullRow | null): PullRow[] {
  let data: unknown
  try { data = JSON.parse(text) } catch { return [] }
  const out: PullRow[] = []
  walk(data, pick, out)
  return out
}

function slackTarget(channel: string, thread: string): Pick<PullRow, 'audience' | 'target' | 'channel' | 'thread'> {
  if (!channel) return {}
  return { audience: /^[DU]/.test(channel) ? 'slack-dm' : 'slack-channel', target: `${channel}:${thread}`, channel, ...(thread ? { thread } : {}) }
}

function slackRow(authorId: string, rawTs: unknown, text: string, channel: string, thread: string, permalink: string): PullRow | null {
  const ts = iso(rawTs)
  if (!authorId || !ts || !text.trim()) return null
  return { id: `slack:${channel}:${str(rawTs)}`, source: 'slack', ts, authorId, text: text.trim(), ...slackTarget(channel, thread), ...(permalink ? { permalink } : {}) }
}

const slackBlocks: Extractor = {
  name: 'slack-blocks',
  test: (t) => /^From:.*\(ID: [A-Z0-9]+\)/m.test(t) && /^Message_ts:/m.test(t),
  extract(text) {
    const rows: PullRow[] = []
    for (const chunk of text.split(/^-{3,}\s*$/m)) {
      const field = (name: string) => chunk.match(new RegExp(`^${name}:\\s*(.*)$`, 'm'))?.[1]?.trim() ?? ''
      const from = chunk.match(/^From:.*\(ID: ([A-Z0-9]+)\)/m)?.[1] ?? ''
      const channel = chunk.match(/^Channel:.*\(ID: ([A-Z0-9]+)\)/m)?.[1] ?? ''
      const body = chunk.match(/^Text:[ \t]*([\s\S]*)$/m)?.[1] ?? ''
      const row = slackRow(from, field('Message_ts'), body, channel, field('Thread_ts'), field('Permalink'))
      if (row) rows.push(row)
    }
    return rows
  },
}

const slackJson: Extractor = {
  name: 'slack-json',
  test: jsonish,
  extract: (text) => jsonRows(text, (o) =>
    typeof o.user === 'string' && typeof o.text === 'string' && /^\d{9,11}\.\d+$/.test(str(o.ts))
      ? slackRow(o.user, o.ts, o.text, str(o.channel), str(o.thread_ts), str(o.permalink))
      : null),
}

const jiraJson: Extractor = {
  name: 'jira-json',
  test: jsonish,
  extract: (text) => jsonRows(text, (o) => {
    const accountId = isObj(o.author) ? str(o.author.accountId) : ''
    const body = adf(o.body).trim()
    const ts = iso(o.created)
    if (!accountId || !body || !ts || !str(o.id)) return null
    const issue = str(o.issueKey) || str(o.issueId)
    return { id: `jira:${str(o.id)}`, source: 'jira', ts, authorId: accountId, text: body, ...(issue ? { issue, audience: 'jira' as const, target: issue } : {}) }
  }),
}

const githubJson: Extractor = {
  name: 'github-json',
  test: jsonish,
  extract: (text) => jsonRows(text, (o) => {
    const login = isObj(o.user) ? str(o.user.login) : ''
    const body = str(o.body).trim()
    const ts = iso(o.created_at ?? o.submitted_at)
    if (!login || !body || !ts || !str(o.id)) return null
    const url = str(o.html_url)
    const m = url.match(/github\.com\/([\w.-]+\/[\w.-]+)\/(?:pull|issues)\/(\d+)/)
    return {
      id: `github:${str(o.id)}`, source: 'github', ts, authorId: login, text: body,
      ...(url ? { permalink: url } : {}),
      ...(m ? { repo: m[1], number: Number(m[2]), audience: 'github-pr' as const, target: `${m[1]}#${m[2]}` } : {}),
    }
  }),
}

const AUTHOR_KEYS = ['authorId', 'author_id', 'userId', 'user_id', 'accountId', 'account_id', 'senderId', 'sender_id']
const TEXT_KEYS = ['text', 'body', 'content', 'message']
const TS_KEYS = ['ts', 'timestamp', 'created', 'created_at', 'createdAt', 'time', 'date']
const firstOf = (o: Obj, keys: string[]) => keys.map((k) => ({ k, v: str(o[k]) })).find((x) => x.v)

const genericJson: Extractor = {
  name: 'generic-json',
  test: jsonish,
  extract: (text) => jsonRows(text, (o) => {
    const a = firstOf(o, AUTHOR_KEYS)
    const b = firstOf(o, TEXT_KEYS)
    const t = firstOf(o, TS_KEYS)
    const ts = t ? iso(t.v) : ''
    if (!a || !b || !ts) return null
    const native = str(o.id) || `${a.v}:${ts}`
    return { id: `generic:${native}`, source: 'generic', ts, authorId: a.v, text: b.v.trim() }
  }),
}

export const extractors: Extractor[] = [slackBlocks, slackJson, jiraJson, githubJson, genericJson]

function selfFor(row: PullRow, id: Identity): boolean {
  if (row.source === 'slack') return row.authorId === id.slackId
  if (row.source === 'github') return row.authorId === id.ghLogin
  if (row.source === 'jira') return row.authorId === id.accountId
  return [id.slackId, id.ghLogin, id.accountId].includes(row.authorId)
}

export function observe(tool: string, input: Record<string, unknown>, resultText: string, identity: Identity): PullRow[] {
  if (!identity.slackId && !identity.ghLogin && !identity.accountId) return []
  if (NO_OBSERVE.has(tool)) return []
  if (tool === 'Bash') {
    const cmd = typeof input.command === 'string' ? input.command : ''
    if (WRITING_CALL.test(cmd) || audienceOf(tool, input)) return []
  }
  if (typeof resultText !== 'string' || resultText.length > MAX_CHARS) return []
  const matching = extractors.filter((x) => jsonish(resultText) || x.test(resultText))
  for (const x of matching) {
    let rows: PullRow[] = []
    try { rows = x.extract(resultText, tool) } catch { continue }
    if (!rows.length) continue
    const seen = new Set<string>()
    return rows
      .filter((r) => !seen.has(r.id) && !!seen.add(r.id))
      .map((r) => ({ ...r, author: selfFor(r, identity) ? 'self' as const : 'other' as const }))
  }
  return []
}
