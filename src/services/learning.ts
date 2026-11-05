import fs from 'fs'
import os from 'os'
import path from 'path'
import type { Collection } from 'mongodb'
import { getDb } from './db'
import { settings } from './settings'

export type LearningGran = 'day' | 'week' | 'month'
export type LearningAudience = 'slack-dm' | 'slack-channel' | 'jira' | 'confluence' | 'github-pr'
export type LearningSource = 'slack' | 'jira' | 'confluence' | 'github' | 'prompts' | 'notes' | 'observed' | 'edits-feedback'
export type LearntKind = 'feature' | 'structure' | 'token' | 'nepali' | 'perspective' | 'feedback-rule' | 'edit-rule'
export type LearningRunKind = 'learn' | 'refresh' | 'other'
export type ProfileStatus = 'active' | 'insufficient' | 'no profile'
export type FolderVia = 'env' | 'vaultPath' | 'cached' | 'default'

export interface LabelCounts { human: number; ai: number; unsure: number }
export interface CaptureCounts { pull: number; observed: number; prompts: number; feedback: number; edits: number }

export interface LearningBucket {
  key: string            // '2026-11-05' | '2026-W45' | '2026-11'
  start: string          // ISO date of bucket start, for sorting/axis
  learnt: LabelCounts
  captures: CaptureCounts
  cumulativeHuman: number
}

export interface LearningRun { date: string; kind: LearningRunKind }

export interface AudienceInsight {
  audience: LearningAudience
  humanSamples: number
  lastUpdated: string | null
  profile: ProfileStatus
  frontmatterSamples: number | null
  topMarkers: string[]   // max 3, feature/structure names only
}

export interface LearningHealth {
  lastRun: string | null
  stale: boolean
  staleDays: number
  lock: 'learn' | 'refresh' | null
  coverageFrom: string | null
  eval: { precision: number | null; recall: number | null }
}

export interface LearningCurrent {
  empty: boolean
  hint: string | null    // '/more-like-you learn' when empty
  totals: LabelCounts & { captures: CaptureCounts }
  learnt: Record<LearntKind, number>
  structureByAudience: Record<LearningAudience, number>
  sources: Record<LearningSource, number>
  audiences: AudienceInsight[]
  health: LearningHealth
  runs: LearningRun[]
}

export type LearningResponse =
  | {
      ok: true
      gran: LearningGran
      current: LearningCurrent
      history: LearningBucket[]
      source: 'mongo' | 'vault'
      mongoDown: boolean
      folder: { via: FolderVia; display: string }
    }
  | { ok: false; error: string }

export interface LearningDayDoc {
  _id: string                         // 'day:YYYY-MM-DD'
  type: 'day'
  date: string
  learnt: LabelCounts
  captures: CaptureCounts
  sources: Record<LearningSource, number>
  humanByAudience: Record<LearningAudience, number>
  updatedAt: Date
}
export interface LearningRunDoc { _id: string; type: 'run'; date: string; kind: LearningRunKind } // 'run:<date>:<n>', n = 1-based order within that date

const AUDIENCES: LearningAudience[] = ['slack-dm', 'slack-channel', 'jira', 'confluence', 'github-pr']
const TITLES: Record<LearningAudience, string> = { 'slack-dm': 'Slack DM', 'slack-channel': 'Slack channel', jira: 'Jira', confluence: 'Confluence', 'github-pr': 'GitHub PR' }
const SOURCES: LearningSource[] = ['slack', 'jira', 'confluence', 'github', 'prompts', 'notes', 'observed', 'edits-feedback']
const KINDS: LearntKind[] = ['feature', 'structure', 'token', 'nepali', 'perspective', 'feedback-rule', 'edit-rule']
const CAPTURES = ['pull', 'observed', 'prompts', 'feedback', 'edits'] as const
const LABELS = ['human', 'ai', 'unsure'] as const
const PULL_SOURCES = new Set<string>(['slack', 'jira', 'confluence', 'github'])
const CLASSIFIED_SOURCE = new Map<string, LearningSource>([['notes', 'notes'], ['transcript', 'prompts']])
const DAY = 86_400_000
const LEARN_LOCK_MS = 30 * 60_000
const REFRESH_LOCK_MS = 60 * 60_000
const SNAPSHOT_INTERVAL_MS = 30 * 60_000
const HINT = '/more-like-you learn'

const zero = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>
const isAudience = (v: unknown): v is LearningAudience => AUDIENCES.includes(v as LearningAudience)
const dateOf = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString().slice(0, 10) : null)

export function resolveLearningFolder(env: Record<string, string | undefined>, home: string, vaultPath?: string): { folder: string; via: FolderVia } {
  const expand = (p: string) => (p === '~' || p.startsWith('~/') ? home + p.slice(1) : p)
  if (env.MORE_LIKE_YOU_VAULT) return { folder: expand(env.MORE_LIKE_YOU_VAULT), via: 'env' }
  const root = env.VAULT_PATH || vaultPath
  if (root) return { folder: `${expand(root).replace(/\/$/, '')}/more-like-you`, via: 'vaultPath' }
  const dflt = `${home}/.claude/more-like-you`
  try {
    const cached = JSON.parse(fs.readFileSync(`${dflt}/location.json`, 'utf8'))?.folder
    if (typeof cached === 'string' && cached) return { folder: expand(cached), via: 'cached' }
  } catch {}
  return { folder: dflt, via: 'default' }
}

type Rec = Record<string, unknown>
type Kind = 'classified' | 'judged' | 'nepali' | (typeof CAPTURES)[number]

export const readStats = { parses: 0 }
const cache = new Map<string, { sig: string; rows: Rec[] }>()
const FILE = /^(\d{4}-\d{2}-\d{2})-(classified(?:-(\d+))?|(?:\w+-)?pull|observed|prompts|feedback|edits|judged|nepali-learnt)\.jsonl$/

function reduce(kind: Kind, o: Rec): Rec {
  if (kind === 'classified') {
    const ps = Array.isArray(o.paragraphs) ? (o.paragraphs as Rec[]) : []
    return { id: o.id, source: o.source, author: o.author, audience: o.audience, labels: ps.map((p) => p?.label) }
  }
  if (kind === 'judged') return { pid: o.pid, label: o.label }
  if (kind === 'nepali') return { section: o.section }
  return kind === 'pull' ? { ts: o.ts, source: o.source } : { ts: o.ts }
}

async function parseJsonl(file: string, kind: Kind): Promise<Rec[]> {
  const st = await fs.promises.stat(file)
  const sig = `${st.mtimeMs}:${st.size}`
  const hit = cache.get(file)
  if (hit && hit.sig === sig) return hit.rows
  readStats.parses++
  const rows: Rec[] = []
  for (const line of (await fs.promises.readFile(file, 'utf8')).split('\n')) {
    if (!line.trim()) continue
    try {
      const o = JSON.parse(line)
      if (o && typeof o === 'object' && !Array.isArray(o)) rows.push(reduce(kind, o))
    } catch {}
  }
  cache.set(file, { sig, rows })
  return rows
}

interface ClassRow { id: string; source: string; author: string; audience: unknown; labels: unknown[]; date: string }
interface FolderData {
  hasRaw: boolean
  classified: ClassRow[]
  judged: Map<string, unknown>
  ts: Record<(typeof CAPTURES)[number], { ts: string; source?: string }[]>
  nepaliLearnt: number | null
  text: Record<string, string | null>
}

const TEXT_FILES = ['phrasebook.md', 'style-profile.md', 'rules.md', 'perspective.md', 'nepali-glossary.md', 'changelog.md', 'cursor.json', 'config.json', '.learn.lock', '.refresh.lock']

export async function readFolder(folder: string): Promise<FolderData> {
  const names = await fs.promises.readdir(path.join(folder, 'raw')).catch(() => [] as string[])
  const files = names
    .flatMap((name) => {
      const m = FILE.exec(name)
      if (!m) return []
      const kind: Kind = m[2].startsWith('classified') ? 'classified' : m[2] === 'nepali-learnt' ? 'nepali' : m[2].endsWith('pull') ? 'pull' : (m[2] as Kind)
      return [{ name, date: m[1], kind, n: m[3] ? Number(m[3]) : 1 }]
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.n - b.n)
  const byId = new Map<string, ClassRow>()
  const judged = new Map<string, unknown>()
  const ts = { pull: [], observed: [], prompts: [], feedback: [], edits: [] } as FolderData['ts']
  let nepaliLearnt: number | null = null
  for (const f of files) {
    const rows = await parseJsonl(path.join(folder, 'raw', f.name), f.kind)
    if (f.kind === 'classified') {
      for (const r of rows) if (typeof r.id === 'string') byId.set(r.id, { id: r.id, source: String(r.source), author: String(r.author), audience: r.audience, labels: r.labels as unknown[], date: f.date })
    } else if (f.kind === 'judged') {
      for (const r of rows) if (typeof r.pid === 'string') judged.set(r.pid, r.label)
    } else if (f.kind === 'nepali') {
      nepaliLearnt = (nepaliLearnt ?? 0) + rows.filter((r) => r.section === 'learnt').length
    } else {
      for (const r of rows) ts[f.kind].push({ ts: typeof r.ts === 'string' ? r.ts : '', source: typeof r.source === 'string' ? r.source : undefined })
    }
  }
  const text: FolderData['text'] = {}
  for (const name of TEXT_FILES) text[name] = await fs.promises.readFile(path.join(folder, name), 'utf8').catch(() => null)
  return { hasRaw: files.length > 0, classified: [...byId.values()], judged, ts, nepaliLearnt, text }
}

function finalLabel(label: unknown, judged: unknown): keyof LabelCounts {
  if (label === 'ai' || label === 'mixed') return 'ai'
  const v = judged ?? label
  return v === 'human' || v === 'ai' ? v : 'unsure'
}

function json(text: string | null): Rec {
  try {
    const v = text ? JSON.parse(text) : null
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {}
  } catch {
    return {}
  }
}

function frontmatter(md: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  const m = md?.match(/^---\n([\s\S]*?)\n---/)
  for (const line of m?.[1].split('\n') ?? []) {
    const kv = line.match(/^([\w.-]+):\s*(.*?)\s*$/)
    if (kv) out[kv[1]] = kv[2]
  }
  return out
}

function profileStatus(md: string | null, audience: LearningAudience): ProfileStatus {
  if (md === null) return 'no profile'
  const section = md.split(/^## /m).slice(1).find((s) => s.split('\n')[0].trim() === TITLES[audience])
  const body = section?.slice(section.indexOf('\n') + 1).trim() ?? ''
  return !body || /insufficient samples/i.test(body) ? 'insufficient' : 'active'
}

interface Marker { kind: 'feature' | 'token' | 'structure'; pattern: string; weight: number }

function parseMarkers(md: string | null): Marker[] {
  if (!md) return []
  const at = md.search(/^## Markers\s*$/m)
  const body = at < 0 ? md : md.slice(at).replace(/^## Markers\s*\n/, '').split(/^## /m)[0]
  const out: Marker[] = []
  for (const line of body.split('\n')) {
    const r = line.match(/^- (feature|token|structure) (\S+) (-?[\d.]+) (\d+) (\d+)\s*$/)
    if (r && !(r[1] === 'token' && /\p{L}/u.test(r[2]))) out.push({ kind: r[1] as Marker['kind'], pattern: r[2], weight: Number(r[3]) })
  }
  return out
}

const bullets = (md: string | null) => (md ?? '').split('\n').filter((l) => l.startsWith('- ')).length

function sectionBullets(md: string | null, heading: RegExp): number {
  const at = (md ?? '').search(heading)
  if (!md || at < 0) return 0
  return bullets(md.slice(at).replace(/^.*\n/, '').split(/^#{1,3} /m)[0])
}

function parseRuns(md: string | null): LearningRun[] {
  const out: LearningRun[] = []
  for (const m of (md ?? '').matchAll(/^## (\d{4}-\d{2}-\d{2}) +(\S+)/gm)) {
    if (Number.isNaN(Date.parse(m[1]))) continue
    const first = m[2].toLowerCase()
    out.push({ date: m[1], kind: first.startsWith('learn') ? 'learn' : first.startsWith('refresh') ? 'refresh' : 'other' })
  }
  return out
}

function lockActive(text: string | null, now: Date, maxAgeMs: number): boolean {
  const t = Date.parse(String(json(text).startedAt))
  return !Number.isNaN(t) && now.getTime() - t < maxAgeMs
}

export async function buildLearning(folder: string, now: Date): Promise<{ current: LearningCurrent; days: LearningDayDoc[]; runs: LearningRunDoc[] }> {
  const data = await readFolder(folder)
  const dayMap = new Map<string, LearningDayDoc>()
  const day = (date: string): LearningDayDoc => {
    let d = dayMap.get(date)
    if (!d) {
      d = { _id: `day:${date}`, type: 'day', date, learnt: zero(LABELS), captures: zero(CAPTURES), sources: zero(SOURCES), humanByAudience: zero(AUDIENCES), updatedAt: now }
      dayMap.set(date, d)
    }
    return d
  }
  for (const r of data.classified) {
    const d = day(r.date)
    const src = CLASSIFIED_SOURCE.get(r.source)
    if (src) d.sources[src]++
    if (r.author !== 'self') continue
    r.labels.forEach((l, i) => {
      const f = finalLabel(l, data.judged.get(`${r.id}#${i}`))
      d.learnt[f]++
      if (f === 'human' && isAudience(r.audience)) d.humanByAudience[r.audience]++
    })
  }
  for (const k of CAPTURES) {
    for (const { ts: stamp, source } of data.ts[k]) {
      const t = Date.parse(stamp)
      if (Number.isNaN(t)) continue
      const d = day(new Date(t).toISOString().slice(0, 10))
      d.captures[k]++
      if (k === 'pull' && source && PULL_SOURCES.has(source)) d.sources[source as LearningSource]++
      if (k === 'observed' || k === 'prompts') d.sources[k]++
      if (k === 'feedback' || k === 'edits') d.sources['edits-feedback']++
    }
  }
  const days = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date))

  const totals = { ...zero(LABELS), captures: zero(CAPTURES) }
  const sources = zero(SOURCES)
  for (const d of days) {
    for (const k of LABELS) totals[k] += d.learnt[k]
    for (const k of CAPTURES) totals.captures[k] += d.captures[k]
    for (const k of SOURCES) sources[k] += d.sources[k]
  }

  const runList = parseRuns(data.text['changelog.md'])
  const seen = new Map<string, number>()
  const runs: LearningRunDoc[] = runList.map((r) => {
    const n = (seen.get(r.date) ?? 0) + 1
    seen.set(r.date, n)
    return { _id: `run:${r.date}:${n}`, type: 'run', date: r.date, kind: r.kind }
  })

  const markers = parseMarkers(data.text['phrasebook.md'])
  const structured = markers
    .filter((m) => m.kind === 'structure')
    .map((m) => ({ audience: m.pattern.split(':')[0], name: m.pattern.slice(m.pattern.indexOf(':') + 1), weight: m.weight }))
  const structureByAudience = zero(AUDIENCES)
  for (const m of structured) if (isAudience(m.audience)) structureByAudience[m.audience]++
  const features = markers.filter((m) => m.kind === 'feature').map((m) => ({ name: m.pattern, weight: m.weight }))
  const learnt = zero(KINDS)
  learnt.feature = features.length
  learnt.structure = structured.length
  learnt.token = markers.filter((m) => m.kind === 'token').length
  learnt.nepali = data.nepaliLearnt ?? sectionBullets(data.text['nepali-glossary.md'], /^## Learnt\s*$/m)
  learnt.perspective = bullets(data.text['perspective.md'])
  learnt['feedback-rule'] = (data.text['rules.md'] ?? '').split('\n').filter((l) => /\(seen \d+\)\s*$/.test(l)).length
  learnt['edit-rule'] = sectionBullets(data.text['rules.md'], /^### Edits\s*$/m)

  const profile = data.text['style-profile.md']
  const fm = frontmatter(profile)
  const audiences: AudienceInsight[] = AUDIENCES.map((audience) => {
    const raw = fm[`samples.${audience}`] ?? fm.samples
    const own = structured.filter((m) => m.audience === audience)
    return {
      audience,
      humanSamples: days.reduce((n, d) => n + d.humanByAudience[audience], 0),
      lastUpdated: [...days].reverse().find((d) => d.humanByAudience[audience] > 0)?.date ?? null,
      profile: profileStatus(profile, audience),
      frontmatterSamples: raw !== undefined && Number.isFinite(Number(raw)) ? Number(raw) : null,
      topMarkers: [...features, ...own].sort((a, b) => b.weight - a.weight).slice(0, 3).map((m) => m.name)
    }
  })

  const cursor = json(data.text['cursor.json'])
  const staleDaysRaw = json(data.text['config.json']).staleDays
  const staleDays = typeof staleDaysRaw === 'number' && Number.isFinite(staleDaysRaw) && staleDaysRaw > 0 ? staleDaysRaw : 7
  const lastRun = [dateOf(cursor.updatedAt), ...runList.map((r) => r.date)].filter((d): d is string => !!d).sort().pop() ?? null
  const evals = parseEval(data.text['changelog.md'] ?? '')
  const fmPrecision = Number(fm.precision)
  const health: LearningHealth = {
    lastRun,
    stale: lastRun !== null && now.getTime() - Date.parse(lastRun) > staleDays * DAY,
    staleDays,
    lock: lockActive(data.text['.learn.lock'], now, LEARN_LOCK_MS) ? 'learn' : lockActive(data.text['.refresh.lock'], now, REFRESH_LOCK_MS) ? 'refresh' : null,
    coverageFrom: dateOf(cursor.coverageFrom),
    eval: evals
      ? evals
      : { precision: fm.precision !== undefined && Number.isFinite(fmPrecision) ? fmPrecision : null, recall: null }
  }

  const empty = !data.hasRaw
  return {
    current: { empty, hint: empty ? HINT : null, totals, learnt, structureByAudience, sources, audiences, health, runs: runList },
    days,
    runs
  }
}

export function parseEval(text: string): { precision: number; recall: number } | null {
  const m = [...text.matchAll(/precision(?:\(human\))?\s*[=:]?\s*(\d*\.?\d+)\s*[,\s]\s*recall(?:\(human\))?\s*[=:]?\s*(\d*\.?\d+)/gi)].pop()
  return m ? { precision: Number(m[1]), recall: Number(m[2]) } : null
}

type DayRow = Pick<LearningDayDoc, 'date' | 'learnt' | 'captures'>

export function mergeDays(mongo: DayRow[], vault: DayRow[], today: string): DayRow[] {
  const byDate = new Map(mongo.map((d) => [d.date, d]))
  for (const v of vault) if (v.date === today || !byDate.has(v.date)) byDate.set(v.date, v)
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function bucketOf(date: string, gran: LearningGran): { key: string; start: string } {
  if (gran === 'day') return { key: date, start: date }
  if (gran === 'month') return { key: date.slice(0, 7), start: `${date.slice(0, 7)}-01` }
  const t = Date.parse(date)
  const monday = t - ((new Date(t).getUTCDay() + 6) % 7) * DAY
  const thursday = new Date(monday + 3 * DAY)
  const year = thursday.getUTCFullYear()
  const jan4 = Date.UTC(year, 0, 4)
  const week1Thursday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY + 3 * DAY
  const week = 1 + Math.round((thursday.getTime() - week1Thursday) / (7 * DAY))
  return { key: `${year}-W${String(week).padStart(2, '0')}`, start: new Date(monday).toISOString().slice(0, 10) }
}

export function bucket(days: Pick<LearningDayDoc, 'date' | 'learnt' | 'captures'>[], gran: LearningGran): LearningBucket[] {
  const out = new Map<string, LearningBucket>()
  for (const d of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    const { key, start } = bucketOf(d.date, gran)
    let b = out.get(key)
    if (!b) {
      b = { key, start, learnt: zero(LABELS), captures: zero(CAPTURES), cumulativeHuman: 0 }
      out.set(key, b)
    }
    for (const k of LABELS) b.learnt[k] += d.learnt[k]
    for (const k of CAPTURES) b.captures[k] += d.captures[k]
  }
  let total = 0
  return [...out.values()].map((b) => ({ ...b, cumulativeHuman: (total += b.learnt.human) }))
}

export async function upsertSnapshots(
  col: Pick<Collection, 'updateOne'>,
  days: LearningDayDoc[],
  runs: LearningRunDoc[],
  today: string
): Promise<void> {
  for (const { _id, ...rest } of days) await col.updateOne({ _id } as never, rest.date === today ? { $set: rest } : { $setOnInsert: rest }, { upsert: true })
  for (const { _id, ...rest } of runs) await col.updateOne({ _id } as never, { $setOnInsert: rest }, { upsert: true })
}

const snapshotFile = (folder: string) => path.join(folder, 'insights', 'snapshots.jsonl')

export function readSnapshotFile(folder: string): { days: LearningDayDoc[]; runs: LearningRunDoc[] } {
  const days: LearningDayDoc[] = []
  const runs: LearningRunDoc[] = []
  let text = ''
  try {
    text = fs.readFileSync(snapshotFile(folder), 'utf8')
  } catch {}
  for (const line of text.split('\n')) {
    try {
      const o = JSON.parse(line)
      if (o?.type === 'day' && typeof o._id === 'string' && typeof o.date === 'string') days.push({ ...o, updatedAt: new Date(o.updatedAt) })
      else if (o?.type === 'run' && typeof o._id === 'string') runs.push(o)
    } catch {}
  }
  return { days, runs }
}

export function writeSnapshotFile(folder: string, days: LearningDayDoc[], runs: LearningRunDoc[], today: string): boolean {
  if (!fs.existsSync(folder)) return false
  const old = readSnapshotFile(folder)
  const mergedDays = new Map(old.days.map((d) => [d._id, d]))
  for (const d of days) if (d.date === today || !mergedDays.has(d._id)) mergedDays.set(d._id, d)
  const mergedRuns = new Map(old.runs.map((r) => [r._id, r]))
  for (const r of runs) if (!mergedRuns.has(r._id)) mergedRuns.set(r._id, r)
  const file = snapshotFile(folder)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmpFile = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmpFile, [...mergedDays.values(), ...mergedRuns.values()].map((d) => JSON.stringify(d)).join('\n') + '\n')
  fs.renameSync(tmpFile, file)
  return true
}

export async function refreshInto(folder: string, now: Date, col: Pick<Collection, 'updateOne'> | null): Promise<void> {
  const today = now.toISOString().slice(0, 10)
  const { days, runs } = await buildLearning(folder, now)
  if (!col) {
    writeSnapshotFile(folder, days, runs, today)
    return
  }
  const cached = readSnapshotFile(folder)
  await upsertSnapshots(col, cached.days, cached.runs, today)
  await upsertSnapshots(col, days, runs, today)
}

const folderNow = () => resolveLearningFolder(process.env, os.homedir(), settings().vaultPath)
const display = (folder: string) => (folder.startsWith(os.homedir() + '/') ? '~' + folder.slice(os.homedir().length) : folder)

let running = false
let failing = false

export async function refreshLearningSnapshots(): Promise<void> {
  if (running) return
  running = true
  try {
    const col = await getDb().then((db) => db.collection('learning_snapshots'), () => null)
    await refreshInto(folderNow().folder, new Date(), col)
  } finally {
    running = false
  }
}

export function startLearningSnapshots(): void {
  const tick = async () => {
    try {
      await refreshLearningSnapshots()
      if (failing) console.log('learning snapshots recovered')
      failing = false
    } catch (e) {
      if (!failing) console.error('learning snapshots failed:', (e as Error).message)
      failing = true
    }
  }
  void tick()
  setInterval(tick, SNAPSHOT_INTERVAL_MS)
}

type ReadCol = Pick<Collection<LearningDayDoc>, 'find'>

export async function readLearning(gran: LearningGran, folder: string, via: FolderVia, now: Date, getCol: () => Promise<ReadCol | null>): Promise<LearningResponse> {
  const built = await buildLearning(folder, now)
  const today = now.toISOString().slice(0, 10)
  let days: Pick<LearningDayDoc, 'date' | 'learnt' | 'captures'>[] = built.days
  let source: 'mongo' | 'vault' = 'vault'
  let mongoDown = false
  try {
    const col = await getCol()
    if (!col) throw new Error('mongo unavailable')
    const docs = await col.find({ type: 'day' }).toArray()
    if (docs.length) {
      days = mergeDays(docs, built.days, today)
      source = 'mongo'
    }
  } catch {
    mongoDown = true
    const fileDays = readSnapshotFile(folder).days
    if (fileDays.length) days = mergeDays(fileDays, built.days, today)
  }
  return { ok: true, gran, current: built.current, history: bucket(days, gran), source, mongoDown, folder: { via, display: display(folder) } }
}

export function getLearning(gran: LearningGran): Promise<LearningResponse> {
  const { folder, via } = folderNow()
  return readLearning(gran, folder, via, new Date(), async () => (await getDb()).collection<LearningDayDoc>('learning_snapshots'))
}
