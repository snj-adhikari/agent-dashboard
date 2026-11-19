import type { EngineInterface as Engine, On, PluginOptions } from 'claude-code'
import { expandHome, resolveLedgerDir } from './ledger'

const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const MCP_WRITE = /write|edit|move|create|delete|append/i
const PATH_KEYS = ['file_path', 'notebook_path', 'path']
const FIXED = ['~/.claude/demerits-state', '~/.claude/agent-orchestration/main', '~/.claude/agent-orchestration/runs', '~/.cache/factory']
const WRITERS = new Set(['tee', 'mv', 'rm', 'truncate', 'install', 'ln', 'dd', 'shred'])

export type Guarded = { home: string; roots: string[]; suffix: string }

export function guarded(cfg: PluginOptions, home: string): Guarded {
  const ledger = resolveLedgerDir(cfg, home)
  const parts = ledger.split('/').filter(Boolean)
  return { home, roots: [ledger, ...FIXED.map(p => expandHome(p, home))], suffix: parts.slice(-2).join('/') }
}

function resolve(path: string, home: string): string {
  const abs = expandHome(path.replace(/^\$\{?HOME\}?(?=\/|$)/, '~'), home)
  const out: string[] = []
  for (const seg of abs.split('/')) {
    if (seg === '..') out.pop()
    else if (seg && seg !== '.') out.push(seg)
  }
  return `${abs.startsWith('/') ? '/' : ''}${out.join('/')}`
}

export function touches(arg: string, g: Guarded): boolean {
  const path = arg.trim()
  if (!path) return false
  const abs = resolve(path, g.home)
  if (g.roots.some(r => abs === r || abs.startsWith(`${r}/`))) return true
  if (abs.startsWith('/')) return false
  return !!g.suffix && (abs === g.suffix || abs.startsWith(`${g.suffix}/`))
}

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const v of value) strings(v, out)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, out)
  return out
}

const unquote = (token: string): string => token.replace(/^['"]|['"]$/g, '')

function commandWord(tokens: string[]): number {
  let i = 0
  while (i < tokens.length && (/^[A-Za-z_]\w*=/.test(tokens[i]) || ['sudo', 'env', 'command', 'nohup', 'time'].includes(tokens[i]))) i++
  return i
}

export function bashTouches(command: string, g: Guarded): boolean {
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    for (const m of segment.matchAll(/(?:\d*|&)>>?\s*([^\s<>|;&]+)/g)) if (touches(unquote(m[1]), g)) return true
    const tokens = segment.trim().split(/\s+/).map(unquote)
    const at = commandWord(tokens)
    const word = (tokens[at] ?? '').split('/').pop() ?? ''
    const args = tokens.slice(at + 1).filter(t => !/^-/.test(t))
    if (WRITERS.has(word) && args.some(a => touches(a.replace(/^of=/, ''), g))) return true
    if (word === 'cp' && args.length > 0 && touches(args[args.length - 1], g)) return true
    if (word === 'sed' && tokens.some(t => /^-\w*i|^--in-place/.test(t)) && args.some(a => touches(a, g))) return true
  }
  return false
}

export function targetsProtected(tool: string, args: Record<string, unknown>, g: Guarded): boolean {
  if (FILE_TOOLS.has(tool)) return PATH_KEYS.some(k => typeof args[k] === 'string' && touches(args[k] as string, g))
  if (tool === 'Bash') return typeof args.command === 'string' && bashTouches(args.command, g)
  if (tool.startsWith('mcp__') && MCP_WRITE.test(tool)) return strings(args).some(s => touches(s, g))
  return false
}

const DENY = 'demerits: that path is the points ledger or its state, which only the mod and the user write. Do not retry; tell the user if a change is needed.'
const FAILED = 'demerits: the write guard failed on this call; ask the user before retrying.'

export async function guardToolCall($: Engine, e: any, next: (e: any) => any, cfg: PluginOptions) {
  try {
    const g = guarded(cfg, (await $.env.get('HOME')) ?? '')
    const { tool, ...args } = e as { tool: string } & Record<string, unknown>
    if (targetsProtected(tool, args, g)) return { deny: DENY }
  } catch {
    return { deny: FAILED }
  }
  return next(e)
}

export function install(_on: On, _cfg: PluginOptions): void {}
