import type { EngineInterface as Engine, On, PluginOptions } from 'claude-code'
import { fold, REGISTRY_FILE, type Folded, type RegistryRow, type Reversal } from './balances'
import { ledgerDir, read, readLines, stateDir, writeAtomic, type LedgerEvent } from './ledger'

export const POINTS_FILE = 'points.md'
export const GOOD_WORK_FILE = 'good-work.md'
export const GUIDELINES_FILE = 'guidelines.md'
export const BLOCK_START = '<!-- demerits:start -->'
export const BLOCK_END = '<!-- demerits:end -->'

const DAY_MS = 86_400_000
const LAST_EVENTS = 20
const GOOD_WORK_MAX = 20
const LOST_RULES_MAX = 5
const DONTS = 3
const DOS = 2
const QUOTES = 3
const BLOCK_RE = /\n*<!-- demerits:start -->[\s\S]*?<!-- demerits:end -->\n*/
const MANUAL_RE = /^## Manual[ \t]*\r?\n?/m

export type Line = { slug: string; text: string }

const live = (events: readonly LedgerEvent[]): LedgerEvent[] => {
  const reversed = new Set(events.flatMap(e => ((e as Partial<Reversal>).reverses ? [(e as Reversal).reverses] : [])))
  return events.filter(e => !(e as Partial<Reversal>).reverses && !reversed.has(e.id))
}

const cell = (text: string): string => text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()
const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`)
const when = (ts: number): string => new Date(ts).toISOString().slice(0, 16).replace('T', ' ')
const oneLine = (text: string, max = 120): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

const goodWork = (events: readonly LedgerEvent[]): LedgerEvent[] =>
  live(events).filter(e => e.points > 0 && e.rule !== 'verified-task')

const taskOf = (e: LedgerEvent): string => str(e.evidence.task) || str(e.evidence.ref) || str(e.evidence.taskKey) || '-'

const countsOf = (e: LedgerEvent): string => {
  const src = e.evidence.counts && typeof e.evidence.counts === 'object' ? (e.evidence.counts as Record<string, unknown>) : e.evidence
  return Object.entries(src)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => `${k} ${v}`)
    .join(', ')
}

const groupBy = (events: readonly LedgerEvent[]): { rule: string; count: number; sum: number; latest: LedgerEvent; best: LedgerEvent }[] => {
  const map = new Map<string, LedgerEvent[]>()
  for (const e of events) map.set(e.rule, [...(map.get(e.rule) ?? []), e])
  return [...map.entries()].map(([rule, rows]) => ({
    rule,
    count: rows.length,
    sum: rows.reduce((n, r) => n + r.points, 0),
    latest: rows.reduce((a, b) => (b.ts > a.ts ? b : a)),
    best: rows.reduce((a, b) => (Math.abs(b.points) > Math.abs(a.points) ? b : a)),
  }))
}

export function pointsMd(folded: Folded, events: readonly LedgerEvent[], now: number, windowDays: number): string {
  const rows = live(events)
  const since = now - windowDays * DAY_MS
  const agents = [...folded.agents].sort((a, b) => b.balance - a.balance || a.agent.localeCompare(b.agent))
  const lost = groupBy(rows.filter(e => e.points < 0 && e.ts >= since && e.ts <= now))
    .sort((a, b) => a.sum - b.sum || b.count - a.count)
    .slice(0, LOST_RULES_MAX)
  const recent = [...rows].sort((a, b) => b.ts - a.ts).slice(0, LAST_EVENTS)
  return [
    '# Points',
    '',
    '| Agent | Rank | Balance | Week | XP | Level |',
    '| --- | --- | --- | --- | --- | --- |',
    ...agents.map(a => `| ${cell(a.agent)} | ${a.rank} | ${a.balance} | ${signed(a.week)} | ${a.xp} | ${a.level} |`),
    '',
    `Team pool: ${folded.pool.balance} (${signed(folded.pool.week)} this week)`,
    '',
    '## Top lost rules this week',
    ...(lost.length ? lost.map(l => `- ${l.rule}: ${l.count}x, ${signed(l.sum)}`) : ['- None']),
    '',
    `## Last ${LAST_EVENTS} events`,
    '| Time | Agent | Scope | By | Points | Rule | Reason |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...recent.map(e => `| ${when(e.ts)} | ${cell(e.agent)} | ${e.scope} | ${cell(e.by)} | ${signed(e.points)} | ${e.rule} | ${cell(e.reason)} |`),
    '',
    '[good work](good-work.md)',
    '',
  ].join('\n')
}

export function goodWorkMd(events: readonly LedgerEvent[]): string {
  const best = goodWork(events).sort((a, b) => b.ts - a.ts).slice(0, GOOD_WORK_MAX)
  return [
    '# Good work',
    '',
    ...(best.length
      ? [
          '| Time | Agent | Task | What went right | Points |',
          '| --- | --- | --- | --- | --- |',
          ...best.map(e => {
            const counts = countsOf(e)
            return `| ${when(e.ts)} | ${cell(e.agent)} | ${cell(taskOf(e))} | ${cell(counts ? `${e.reason} (${counts})` : e.reason)} | ${signed(e.points)} |`
          }),
        ]
      : ['None yet.']),
    '',
  ].join('\n')
}

const stripBlock = (text: string): string => text.replace(BLOCK_RE, '\n')

export function manualOverrides(existing: string): Map<string, string> {
  const clean = stripBlock(existing)
  const m = MANUAL_RE.exec(clean)
  const out = new Map<string, string>()
  if (!m) return out
  for (const line of clean.slice(m.index + m[0].length).split('\n')) {
    const slug = /^- ([a-z0-9][a-z0-9-]*):/.exec(line)?.[1]
    if (slug) out.set(slug, line)
  }
  return out
}

export function blockLines(events: readonly LedgerEvent[], overrides: ReadonlyMap<string, string> = new Map()): string[] {
  const rows = live(events)
  const donts: Line[] = groupBy(rows.filter(e => e.points < 0))
    .sort((a, b) => b.count - a.count || a.sum - b.sum)
    .slice(0, DONTS)
    .map(g => ({ slug: g.rule, text: `- ${g.rule}: Don't: ${oneLine(g.latest.reason)} (${g.count}x)` }))
  const dos: Line[] = groupBy(goodWork(rows))
    .sort((a, b) => b.sum - a.sum)
    .slice(0, DOS)
    .map(g => ({ slug: g.rule, text: `- ${g.rule}: Do: ${oneLine(g.best.reason)}` }))
  const lessons = [...donts, ...dos].map(l => overrides.get(l.slug) ?? l.text)
  const quotes = goodWork(rows)
    .sort((a, b) => b.points - a.points || b.ts - a.ts)
    .slice(0, QUOTES)
    .map(e => `> ${oneLine(e.reason)} (${signed(e.points)}, ${e.agent})`)
  return [...new Set(lessons), ...(quotes.length ? ['Good work:', ...quotes] : [])]
}

export function guidelinesMd(existing: string, events: readonly LedgerEvent[]): string {
  const clean = stripBlock(existing)
  const m = MANUAL_RE.exec(clean)
  const pre = m ? clean.slice(0, m.index) : clean.trim() ? `${clean.trimEnd()}\n\n` : '# Guidelines\n\n'
  const body = (m ? clean.slice(m.index + m[0].length) : '').trimEnd()
  const inner = blockLines(events, manualOverrides(existing))
  return `${pre}## Manual\n${body ? `${body}\n` : ''}\n${[BLOCK_START, ...inner, BLOCK_END].join('\n')}\n`
}

async function readText($: Engine, path: string): Promise<string> {
  return (await $.fs.exists(path)) ? (($.fs.read(path) as Promise<string>)) : ''
}

export async function guidelinesBlock($: Engine, cfg: PluginOptions): Promise<string> {
  const dir = await ledgerDir($, cfg)
  const existing = await readText($, `${dir}/${GUIDELINES_FILE}`)
  return blockLines(await read($, cfg), manualOverrides(existing)).join('\n')
}

export async function regenerate($: Engine, cfg: PluginOptions): Promise<void> {
  const dir = await ledgerDir($, cfg)
  const events = await read($, cfg)
  const registry = await readLines<RegistryRow>($, `${await stateDir($)}/${REGISTRY_FILE}`)
  const now = await $.clock.now()
  const windowDays = Number(cfg.windowDays) > 0 ? Number(cfg.windowDays) : 7
  const existing = await readText($, `${dir}/${GUIDELINES_FILE}`)
  await $.process.run(['mkdir', '-p', dir])
  await writeAtomic($, `${dir}/${POINTS_FILE}`, pointsMd(fold(events, registry, now, windowDays), events, now, windowDays))
  await writeAtomic($, `${dir}/${GOOD_WORK_FILE}`, goodWorkMd(events))
  await writeAtomic($, `${dir}/${GUIDELINES_FILE}`, guidelinesMd(existing, events))
}

export function install(_on: On, _cfg: PluginOptions): void {}
