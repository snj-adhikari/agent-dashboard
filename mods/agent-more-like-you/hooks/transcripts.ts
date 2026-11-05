import { targetOf } from './audience'

export interface AgentWrite { tool: string; target: string; text: string; ts: string }

type Obj = Record<string, unknown>

const DROP_CONTAINS = [
  '<command-name>',
  '<local-command-',
  '<bash-',
  '<task-notification>',
  '<system-reminder>',
  'The factory plugin sent a message',
  'Base directory for this skill',
  '[Request interrupted',
]
const DROP_PREFIX = ['You are the factory', 'Finished:', '[subtab', 'STOP:']

const parse = (line: string): Obj | null => {
  try {
    const v = JSON.parse(line)
    return v && typeof v === 'object' ? (v as Obj) : null
  } catch {
    return null
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

const PASTE_BLOCK = /<pasted_content\b[^>]*>([\s\S]*?)<\/pasted_content>/g
const PASTE_MARK = /\[Pasted text #\d+[^\]]*\]/g

export function pastedSpans(text: string): string[] {
  return [...text.matchAll(PASTE_BLOCK)].map((m) => m[1].trim()).filter(Boolean)
}

export function cleanPrompt(content: string, minWords = 3): string | null {
  if (DROP_CONTAINS.some((m) => content.includes(m))) return null
  const text = content.replace(PASTE_BLOCK, '').replace(PASTE_MARK, '').trim()
  if (DROP_PREFIX.some((p) => text.startsWith(p)) || /^\/\S*$/.test(text)) return null
  return text.split(/\s+/).filter(Boolean).length < minWords ? null : text
}

const SECRETS = [
  /\b(?:sk-|ghp_|gho_|github_pat_|xox[abpr]-|AKIA|AIza)[\w-]{8,}/g,
  /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g,
  /\bBearer\s+[\w.~+/=-]+/gi,
  /\b\w*(?:key|token|secret|password)\s*=\s*\S+/gi,
  /\b[0-9a-fA-F]{32,}\b/g,
  /[A-Za-z0-9+/]{32,}={0,2}/g,
]

export function redact(text: string): string {
  return SECRETS.reduce((t, re) => t.replace(re, '[redacted]'), text)
}

export function typedPrompts(lines: readonly string[], path: string): { text: string; ts: string }[] {
  if (path.includes('/subagents/')) return []
  const out: { text: string; ts: string }[] = []
  for (const line of lines) {
    const r = parse(line)
    if (!r || r.type !== 'user' || r.isSidechain === true || r.isMeta === true) continue
    const content = (r.message as Obj | undefined)?.content
    if (typeof content !== 'string') continue
    const origin = r.origin as Obj | undefined
    const ok = origin
      ? origin.kind === 'human' && r.promptSource === 'typed'
      : r.toolUseResult === undefined && (r.promptSource === undefined || r.promptSource === 'typed')
    if (!ok) continue
    const text = cleanPrompt(content)
    if (text) out.push({ text, ts: str(r.timestamp) })
  }
  return out
}

const stripHtml = (s: string): string =>
  s
    .replace(/<\/(p|li|div|h\d)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim()

const GH = /\bgh\s+(pr\s+(comment|review)|api)\b/
const HEREDOC = /<<-?\s*['"]?(\w+)['"]?[^\n]*\n([\s\S]*?)\n[ \t]*\1(?=\s|$|\)|")/
const BODY_FLAG = /(?:(?:-f|-F|--field|--raw-field)\s+body=|--body(?:=|\s+)|-b\s+)(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+))/

function ghBody(cmd: string): string | null {
  if (!GH.test(cmd)) return null
  const h = HEREDOC.exec(cmd)
  if (h) return h[2].trim()
  const m = BODY_FLAG.exec(cmd)
  if (!m) return null
  return (m[1] !== undefined ? m[1].replace(/\\(["\\$`])/g, '$1') : (m[2] ?? m[3] ?? '')).trim()
}

export function writeText(tool: string, input: Obj): string | null {
  if (/slack_send_message(_draft)?$/.test(tool)) return str(input.message) || null
  if (tool.endsWith('addOrEditJiraIssueComment')) return str(input.commentBody) || null
  if (/Confluence(Footer|Inline)Comment$/.test(tool)) {
    const edits = Array.isArray(input.edits) ? (input.edits as Obj[]).map((e) => str(e.value)).join('\n') : ''
    const raw = str(input.body) || str(input.commentBody) || str(input.value) || edits
    return raw ? stripHtml(raw) : null
  }
  if (tool === 'Bash') return ghBody(str(input.command))
  return null
}

export function agentWrites(lines: readonly string[]): AgentWrite[] {
  const out: AgentWrite[] = []
  for (const line of lines) {
    const r = parse(line)
    if (!r || r.type !== 'assistant') continue
    const content = (r.message as Obj | undefined)?.content
    if (!Array.isArray(content)) continue
    for (const b of content as Obj[]) {
      if (b.type !== 'tool_use') continue
      let tool = str(b.name)
      let input = (b.input ?? {}) as Obj
      if (tool.endsWith('executeWrite')) {
        tool = str(input.name)
        input = (input.inputs ?? {}) as Obj
      }
      const text = writeText(tool, input)
      if (!text) continue
      const target = targetOf(tool, input)
      out.push({ tool, target: target ?? '', text, ts: str(r.timestamp) })
    }
  }
  return out
}

const blocks = (r: Obj): Obj[] => {
  const c = (r.message as Obj | undefined)?.content
  return Array.isArray(c) ? (c as Obj[]) : []
}

const strings = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []

export function aiOutputs(lines: readonly string[]): { text: string; ts: string }[] {
  const out: { text: string; ts: string }[] = []
  const agentCalls = new Set<string>()
  const recs = lines.map(parse).filter((r): r is Obj => r !== null)
  for (const r of recs) {
    if (r.type !== 'assistant') continue
    for (const b of blocks(r)) {
      if (b.type === 'text' && str(b.text)) out.push({ text: str(b.text), ts: str(r.timestamp) })
      if (b.type !== 'tool_use') continue
      if (b.name === 'Agent' || b.name === 'Task') agentCalls.add(str(b.id))
      for (const t of strings(b.input)) out.push({ text: t, ts: str(r.timestamp) })
    }
  }
  for (const r of recs) {
    if (r.type !== 'user') continue
    for (const b of blocks(r)) {
      if (b.type !== 'tool_result' || !agentCalls.has(str(b.tool_use_id))) continue
      for (const t of typeof b.content === 'string' ? [b.content] : Array.isArray(b.content) ? (b.content as Obj[]).map((c) => str(c.text)) : []) out.push({ text: t, ts: str(r.timestamp) })
    }
  }
  return out
}

export function notesWrites(lines: readonly string[], notesDir: string): AgentWrite[] {
  const out: AgentWrite[] = []
  for (const line of lines) {
    const r = parse(line)
    if (!r || r.type !== 'assistant') continue
    for (const b of blocks(r)) {
      const input = (b.input ?? {}) as Obj
      const path = str(input.file_path)
      if (b.type !== 'tool_use' || !path.startsWith(`${notesDir}/`)) continue
      const edits = Array.isArray(input.edits) ? (input.edits as Obj[]).map((e) => str(e.new_string)) : []
      const text = (b.name === 'Write' ? str(input.content) : b.name === 'Edit' ? str(input.new_string) : b.name === 'MultiEdit' ? edits.join('\n\n') : '').trim()
      if (text) out.push({ tool: str(b.name), target: path, text, ts: str(r.timestamp) })
    }
  }
  return out
}
