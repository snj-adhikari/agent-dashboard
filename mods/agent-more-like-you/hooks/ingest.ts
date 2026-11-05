import type { EngineInterface as Ctx } from 'claude-code'
import type { AgentWrite, Audience, Label, PullRow } from './audience'
import { readConfig } from './config'
import { editPair, foldFeedback, type EditPair, type Feedback } from './feedback'
import {
  buildIndex, classifyItem, containment, evaluateBoth, finalLabel, learnMarkers, needsJudge, normalise,
  bestSimilarity, paragraphs, parseMarkers, renderMarkers, updateMarkers, type AiIndex, type Judged, type Markers, type ParagraphResult,
} from './score'
import { agentWrites, aiOutputs, notesWrites, typedPrompts } from './transcripts'

type Cursor = {
  version: number
  identity: Record<string, string>
  coverageFrom?: string
  observed?: Record<string, string>
  coverageBySource?: Record<string, string>
  updatedAt?: string
  localFoldAt?: string
  [source: string]: unknown
}
type Row = {
  id: string
  source: string
  audience: Audience | null
  ts: string
  text: string
  author: 'self' | 'other' | 'unknown'
  label: Label
  sim: number
  score: number
  signals: string[]
  paragraphs: ParagraphResult[]
}

const PATTERN =
  '"promptSource":"typed"|"role":"user","content":"|"type":"assistant"|"type":"tool_result"'
const PAGE = 2000
const PAGED = 'grep -h -E "$1" "$2" | cut -c1-50000 | sed -n "$3"'
const IDENTITY_KEY: Record<string, string> = { slack: 'slackId', github: 'ghLogin', jira: 'accountId', confluence: 'accountId' }
const iso = (ms: number) => new Date(ms).toISOString()
const lines = (s: string) => s.split('\n').filter((l) => l.trim())
const newer = (a: string | undefined, b: string): string => (a !== undefined && Date.parse(a) >= Date.parse(b) ? a : b)
const hash = (text: string) => {
  let h = 0x811c9dc5
  for (const c of normalise(text)) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0
  return `lab:${h.toString(16)}`
}

async function readText($: Ctx, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

async function readJsonl<T>($: Ctx, folder: string, match: RegExp): Promise<T[]> {
  const out: T[] = []
  for (const f of await $.fs.list(`${folder}/raw`).catch(() => [])) {
    if (f.kind !== 'file' || !match.test(f.name)) continue
    for (const l of lines((await readText($, `${folder}/raw/${f.name}`)) ?? '')) {
      try {
        out.push(JSON.parse(l) as T)
      } catch {}
    }
  }
  return out
}

async function appendJsonl($: Ctx, path: string, rows: object[]): Promise<void> {
  if (!rows.length) return
  const old = (await readText($, path)) ?? ''
  await $.fs.write(path, old + (old && !old.endsWith('\n') ? '\n' : '') + rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
}

const today = () => iso(Date.now()).slice(0, 10)

function targetOfRow(r: PullRow): string {
  if (r.target !== undefined) return r.target
  if (r.source === 'slack') return `${r.channel ?? ''}:${r.thread ?? ''}`
  if (r.source === 'jira') return r.issue ?? ''
  if (r.source === 'confluence') return r.contentId ?? ''
  if (r.source === 'github') return `${r.repo ?? ''}#${r.number ?? ''}`
  return ''
}

function audienceOfRow(r: PullRow): Audience | null {
  if (r.audience) return r.audience
  if (r.source === 'slack') return /^[DU]/.test(r.channel ?? '') ? 'slack-dm' : 'slack-channel'
  if (r.source === 'github') return 'github-pr'
  return r.source === 'jira' || r.source === 'confluence' ? r.source : null
}

async function walk($: Ctx, dir: string, folder: string): Promise<{ path: string; mtimeMs: number }[]> {
  if (dir === folder) return []
  const out: { path: string; mtimeMs: number }[] = []
  for (const e of await $.fs.list(dir).catch(() => [])) {
    const path = `${dir}/${e.name}`
    if (e.kind === 'dir') {
      if (!e.name.startsWith('.')) out.push(...(await walk($, path, folder)))
    } else if (e.kind === 'file' && e.name.endsWith('.md')) out.push({ path, mtimeMs: e.mtimeMs })
  }
  return out
}

async function transcriptFiles($: Ctx, dir: string): Promise<{ path: string; mtimeMs: number }[]> {
  const out: { path: string; mtimeMs: number }[] = []
  for (const e of await $.fs.list(dir).catch(() => [])) {
    const path = `${dir}/${e.name}`
    if (e.kind === 'dir') {
      if (e.name !== 'subagents') out.push(...(await transcriptFiles($, path)))
    } else if (e.kind === 'file' && e.name.endsWith('.jsonl')) out.push({ path, mtimeMs: e.mtimeMs })
  }
  return out
}

const peak = (ps: readonly ParagraphResult[], k: 'sim' | 'score') => ps.reduce((m, p) => Math.max(m, p[k]), 0)

function rowOf(r: { id: string; source: string; ts: string; text: string }, audience: Audience | null, author: Row['author'], label: Label, ps: ParagraphResult[] = []): Row {
  return {
    id: r.id, source: r.source, audience, ts: r.ts, text: r.text, author, label,
    sim: peak(ps, 'sim'), score: peak(ps, 'score'), signals: [...new Set(ps.flatMap((p) => p.signals))], paragraphs: ps,
  }
}

async function writeMarkers($: Ctx, folder: string, m: Markers): Promise<void> {
  const path = `${folder}/phrasebook.md`
  const md = (await readText($, path)) ?? ''
  const at = md.search(/^## Markers\s*$/m)
  if (at < 0) return $.fs.write(path, (md.trim() ? `${md.trimEnd()}\n\n` : '') + renderMarkers(m))
  const next = md.slice(at + 1).search(/^## /m)
  const tail = next < 0 ? '' : `\n${md.slice(at + 1 + next)}`
  await $.fs.write(path, md.slice(0, at) + renderMarkers(m) + tail)
}

export async function ingest($: Ctx, folder: string, home: string, vaultRoot: string | null, full = false): Promise<string> {
  const now = Date.now()
  let ticks = 0
  const tick = async () => {
    if (++ticks % 200 === 0) await $.clock.sleep(0)
  }
  const cfg = readConfig(await readText($, `${folder}/config.json`))
  const prev = JSON.parse((await readText($, `${folder}/cursor.json`)) ?? '{}') as Partial<Cursor>
  const cursor: Cursor = { version: 1, identity: {}, ...prev }
  const prevMarkers = parseMarkers((await readText($, `${folder}/phrasebook.md`)) ?? '')
  const notesRoot = cfg.sources.notes ? (cfg.notesDir ?? vaultRoot) : null

  const writes: AgentWrite[] = []
  const noteWrites: AgentWrite[] = []
  const outputs: { text: string; ts: string }[] = []
  const typed: { text: string; ts: string }[] = []
  let coverageFrom = cursor.coverageFrom
  let read = 0
  let truncated = 0
  let failed = 0
  const tSince = cursor.transcripts && !full ? Date.parse(cursor.transcripts as string) : -Infinity
  for (const f of cfg.sources.transcripts ? await transcriptFiles($, `${home}/.claude/projects`) : []) {
    if (f.mtimeMs < tSince) continue
    const ls: string[] = []
    let ok = true
    let cut = false
    for (let from = 1; ; from += PAGE) {
      const res = await $.process.run(['/bin/sh', '-c', PAGED, 'sh', PATTERN, f.path, `${from},${from + PAGE - 1}p`], { timeoutMs: 120000 }).catch(() => null)
      if (!res || res.exitCode !== 0) {
        ok = false
        break
      }
      if (res.isStdoutTruncated) cut = true
      const page = lines(res.stdout)
      if (!page.length) break
      ls.push(...page)
    }
    if (!ok) {
      failed++
      continue
    }
    read++
    if (cut) truncated++
    await tick()
    for (const l of ls) {
      const m = /"timestamp":"([^"]+)"/.exec(l)
      if (m && !Number.isNaN(Date.parse(m[1])) && (coverageFrom === undefined || Date.parse(m[1]) < Date.parse(coverageFrom))) coverageFrom = m[1]
    }
    writes.push(...agentWrites(ls))
    outputs.push(...aiOutputs(ls))
    typed.push(...typedPrompts(ls, f.path))
    if (notesRoot) noteWrites.push(...notesWrites(ls, notesRoot))
  }
  const coverage = coverageFrom ?? null

  const seenTyped = new Set(typed.map((t) => normalise(t.text)))
  const seen = new Set<string>()
  const pulls: PullRow[] = []
  const prompts: PullRow[] = []
  const observed: PullRow[] = []
  const cursorOf = (key: string): number => (cursor[key] && !full ? Date.parse(cursor[key] as string) : -Infinity)
  const fresh = (r: PullRow, key: string) => {
    const k = `${r.source}:${r.id}`
    if (typeof r.text !== 'string' || typeof r.id !== 'string' || Number.isNaN(Date.parse(r.ts)) || seen.has(k)) return false
    seen.add(k)
    return Date.parse(r.ts) > cursorOf(key)
  }
  for (const r of await readJsonl<PullRow>($, folder, /-pull\.jsonl$/)) if (cfg.sources[r.source as 'slack'] !== false && fresh(r, r.source)) pulls.push(r)
  for (const r of await readJsonl<PullRow>($, folder, /-prompts\.jsonl$/)) {
    if (r.source === 'prompts' && (!cfg.sources.prompts || seenTyped.has(normalise(r.text ?? '')))) continue
    if (fresh(r, r.source)) prompts.push(r)
  }
  for (const r of await readJsonl<PullRow>($, folder, /-observed\.jsonl$/)) {
    const at = full ? undefined : cursor.observed?.[r.source]
    if (fresh(r, '') && (!at || Date.parse(r.ts) > Date.parse(at))) observed.push(r)
  }

  const perspective = await readText($, `${folder}/perspective.md`)
  const index: AiIndex = buildIndex([...outputs, ...noteWrites, ...(perspective ? [{ text: perspective, ts: iso(now) }] : [])])
  const noteParas = noteWrites.flatMap((w) => paragraphs(w.text).filter(wordy).map((t) => ({ ...w, text: t })))
  const human = [...typed, ...prompts.filter((p) => p.source === 'prompts')].map((p) => p.text).filter((t) => containment(t, index) < 0.8)
  const aiTexts = [...writes.map((w) => w.text), ...noteParas.map((w) => w.text)]
  const train = (h: string[], a: string[]): Markers => (prevMarkers?.items.length && !full ? updateMarkers(prevMarkers, h, a) : learnMarkers(h, a))
  const override = (m: Markers): Markers => (cfg.threshold === null ? m : { ...m, threshold: cfg.threshold })

  const rows: Row[] = []
  const notes: { row: PullRow; ps: ParagraphResult[] }[] = []
  const m1 = override(train(human, writes.map((w) => w.text)))
  if (notesRoot) {
    const since = cursorOf('notes')
    for (const f of await walk($, notesRoot, folder)) {
      if (f.mtimeMs <= since) continue
      const body = ((await readText($, f.path)) ?? '').replace(/^---\n[\s\S]*?\n---\n/, '').replace(/```[\s\S]*?```/g, '')
      const ts = iso(f.mtimeMs)
      const cands = noteParas.filter((w) => w.target === f.path).map((w) => ({ ...w, ts: iso(f.mtimeMs - 1) }))
      const paras = paragraphs(body).filter(wordy)
      for (const [n, text] of paras.entries()) {
        await tick()
        const row: PullRow = { id: `notes:${f.path.slice(notesRoot.length + 1)}#${n}`, source: 'notes', ts, text, path: f.path }
        notes.push({ row, ps: classifyItem(text, ts, cands, index, coverage, m1).paragraphs })
      }
    }
  }
  const humanNotes = notes.flatMap((n) => n.ps).filter((p) => p.label === 'human').map((p) => p.text)
  const markers = override(train([...human, ...humanNotes], aiTexts))
  await writeMarkers($, folder, markers)
  for (const n of notes) rows.push(rowOf(n.row, null, 'self', n.ps[0]?.label ?? 'unsure', n.ps))

  const byTarget = new Map<string, AgentWrite[]>()
  for (const w of writes) (byTarget.get(w.target) ?? byTarget.set(w.target, []).get(w.target)!).push(w)
  const pairs: EditPair[] = []
  const self = (r: PullRow): boolean => {
    if (r.author) return r.author === 'self'
    const id = cursor.identity[IDENTITY_KEY[r.source]]
    return r.self === true || (!!id && r.authorId === id)
  }
  for (const r of [...pulls, ...observed]) {
    await tick()
    const audience = audienceOfRow(r)
    if (!self(r)) {
      rows.push(rowOf(r, audience, r.author === 'unknown' ? 'unknown' : 'other', 'unsure'))
      continue
    }
    const target = targetOfRow(r)
    const cands = [...(target !== '' ? byTarget.get(target) ?? [] : []), ...(r.source === 'github' ? byTarget.get('') ?? [] : [])]
    const item = classifyItem(r.text, r.ts, cands, index, coverage, markers)
    rows.push(rowOf(r, audience, 'self', item.label, item.paragraphs))
    const at = Date.parse(r.ts)
    const draft = bestSimilarity(r.text, cands, at)
    if (audience && draft && draft.s >= 0.4 && draft.s < 0.9) pairs.push({ ts: r.ts, audience, before: draft.c.text, after: r.text, ...editPair(draft.c.text, r.text) })
  }
  for (const r of prompts) {
    if (r.source === 'pasted') rows.push(rowOf(r, null, 'unknown', 'unsure'))
    else rows.push(rowOf(r, null, 'self', containment(r.text, index) >= 0.8 ? 'ai' : 'human'))
  }
  for (const t of typed) {
    await tick()
    rows.push(rowOf({ id: `typed:${t.ts}`, source: 'transcript', ts: t.ts, text: t.text }, null, 'self', containment(t.text, index) >= 0.8 ? 'ai' : 'human'))
  }

  const date = today()
  await appendJsonl($, `${folder}/raw/${date}-edits.jsonl`, pairs)
  const feedback = await readJsonl<Feedback>($, folder, /-feedback\.jsonl$/)
  const edits = await readJsonl<EditPair>($, folder, /-edits\.jsonl$/)
  await $.fs.write(`${folder}/rules.md`, foldFeedback(feedback, edits))

  let name = `${date}-classified.jsonl`
  for (let n = 2; await $.fs.exists(`${folder}/raw/${name}`); n++) name = `${date}-classified-${n}.jsonl`
  await $.fs.write(`${folder}/raw/${name}`, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''))

  const observedMax: Record<string, string> = { ...cursor.observed }
  const coverageBySource: Record<string, string> = { ...cursor.coverageBySource }
  for (const r of observed) {
    observedMax[r.source] = newer(observedMax[r.source], r.ts)
    if (self(r)) coverageBySource[r.source] = newer(coverageBySource[r.source], r.ts)
  }
  for (const r of [...pulls, ...prompts]) cursor[r.source] = newer(cursor[r.source] as string | undefined, r.ts)
  for (const n of notes) cursor.notes = newer(cursor.notes as string | undefined, n.row.ts)
  Object.assign(cursor, { observed: observedMax, coverageBySource, transcripts: iso(now), updatedAt: iso(now), localFoldAt: iso(now) })
  if (coverageFrom !== undefined) cursor.coverageFrom = coverageFrom
  await $.fs.write(`${folder}/cursor.json`, JSON.stringify(cursor, null, 2) + '\n')

  const counts = new Map<string, Map<string, number>>()
  for (const r of rows) {
    const key = r.author === 'self' ? r.label : `${r.author}-author`
    const m = counts.get(r.source) ?? new Map<string, number>()
    m.set(key, (m.get(key) ?? 0) + 1)
    counts.set(r.source, m)
  }
  const parts = [...counts].map(([s, m]) => `${s}: ${[...m].map(([k, v]) => `${k} ${v}`).join(', ')}`)
  return `wrote raw/${name} (${rows.length} rows). ${parts.join('; ') || 'no new rows'}. edits ${pairs.length}. coverageFrom ${coverageFrom ?? 'unknown'}. transcripts: ${read} read, ${truncated} truncated, ${failed} failed`
}

const wordy = (t: string) => t.split(/\s+/).filter(Boolean).length >= 3

async function judgedMap($: Ctx, folder: string): Promise<Map<string, Judged>> {
  return new Map((await readJsonl<Judged>($, folder, /-judged\.jsonl$/)).map((j) => [j.pid, j]))
}

export async function runEval($: Ctx, folder: string, file: string): Promise<string> {
  const judged = await judgedMap($, folder)
  const rows = lines(await $.fs.read(file)).map((l) => {
    const r = JSON.parse(l) as { text: string; label: 'human' | 'ai' }
    const j = judged.get(hash(r.text))
    return { ...r, judged: j?.label }
  })
  const markers = parseMarkers((await readText($, `${folder}/phrasebook.md`)) ?? '')
  const cfg = readConfig(await readText($, `${folder}/config.json`))
  return evaluateBoth(rows, markers && cfg.threshold !== null ? { ...markers, threshold: cfg.threshold } : (markers ?? undefined))
}

export async function queue($: Ctx, folder: string, limit: number, file?: string): Promise<{ pid: string; text: string }[]> {
  const cfg = readConfig(await readText($, `${folder}/config.json`))
  const judged = await judgedMap($, folder)
  const doneToday = lines((await readText($, `${folder}/raw/${today()}-judged.jsonl`)) ?? '').length
  const cap = Math.max(0, Math.min(limit, cfg.judgeLimit - doneToday))
  const out: { pid: string; text: string }[] = []
  if (file) {
    for (const l of lines(await $.fs.read(file))) {
      const { text } = JSON.parse(l) as { text: string }
      if (!judged.has(hash(text))) out.push({ pid: hash(text), text })
    }
  } else {
    for (const r of await readJsonl<Row>($, folder, /-classified(-\d+)?\.jsonl$/)) {
      if (r.author !== 'self') continue
      r.paragraphs.forEach((p, i) => {
        if (needsJudge(p) && !judged.has(`${r.id}#${i}`)) out.push({ pid: `${r.id}#${i}`, text: p.text })
      })
    }
  }
  return out.slice(0, cap)
}

export async function label($: Ctx, folder: string, labels: Judged[]): Promise<number> {
  await appendJsonl($, `${folder}/raw/${today()}-judged.jsonl`, labels)
  return labels.length
}

export async function samples($: Ctx, folder: string, audience: Audience): Promise<string[]> {
  const judged = await judgedMap($, folder)
  const out: string[] = []
  for (const r of await readJsonl<Row>($, folder, /-classified(-\d+)?\.jsonl$/)) {
    if (r.author !== 'self' || r.audience !== audience) continue
    r.paragraphs.forEach((p, i) => {
      if (finalLabel(p, judged.get(`${r.id}#${i}`)) === 'human') out.push(p.text)
    })
  }
  return out
}
