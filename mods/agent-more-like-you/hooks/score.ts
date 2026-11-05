import type { AgentWrite, Audience, Label } from './audience'

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const AI_SIM = 0.9
const MIXED_SIM = 0.4
const PRE_COVERAGE_MIN = 0.8
const DEFAULT_THRESHOLD = 0.6
const CONTAIN_AI = 0.8
const MIN_SUPPORT = 2
const WEIGHT_CAP = 0.3
const MIN_WEIGHT = 0.1
const MAX_TOKENS = 40
const MIN_THRESHOLD = 0.55
const PRECISION_TARGET = 0.9

export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/<@[^>]*>/g, ' ')
    .replace(/<https?:[^>]*>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s*[-*•◦▪]\s+/gm, '')
    .replace(/[*_~`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function trigrams(s: string): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3))
  return out
}

type Prep = { norm: string; tri: Set<string> }
const prep = (t: string): Prep => {
  const norm = normalise(t)
  return { norm, tri: trigrams(norm) }
}
const prepped = new WeakMap<object, Prep>()
const prepOf = (c: { text: string }): Prep => {
  let p = prepped.get(c)
  if (!p) prepped.set(c, (p = prep(c.text)))
  return p
}

function dice(x: Prep, y: Prep, floor = 0): number {
  if (x.norm === y.norm) return x.norm.length > 0 ? 1 : 0
  const nx = x.tri.size
  const ny = y.tri.size
  if (nx === 0 || ny === 0) return 0
  if ((2 * Math.min(nx, ny)) / (nx + ny) <= floor) return 0
  const [small, big] = nx <= ny ? [x.tri, y.tri] : [y.tri, x.tri]
  let shared = 0
  for (const g of small) if (big.has(g)) shared++
  return (2 * shared) / (nx + ny)
}

export function similarity(a: string, b: string): number {
  return dice(prep(a), prep(b))
}

export function bestSimilarity(text: string, candidates: readonly AgentWrite[], at: number): { c: AgentWrite; s: number } | null {
  const x = prep(text)
  let best: { c: AgentWrite; s: number } | null = null
  for (const c of candidates) {
    const cts = Date.parse(c.ts)
    if (cts >= at || at - cts > WINDOW_MS) continue
    const s = dice(x, prepOf(c), best?.s ?? 0)
    if (!best || s > best.s) best = { c, s }
  }
  return best
}

export interface Marker { kind: 'feature' | 'token' | 'structure'; pattern: string; weight: number; h: number; a: number }
export interface Markers { threshold: number; humanN: number; aiN: number; items: Marker[] }

const FEATURES: Record<string, RegExp> = {
  'padded-ellipsis': /\s\.{2,3}(?:\s|$)/,
  'lowercase-start': /^[^A-Za-z]*[a-z]/,
  'no-final-stop': /^(?![\s\S]*\.\s*$)[\s\S]+$/,
  'emoji-shortcode': /:[a-z0-9_+-]+:/i,
  emoticon: /(?:^|\s)[:;]-?[)(DPp](?:\s|$)/,
  laughter: /\b(?:ha(?:ha)+|lol|hehe+|lmao)\b/i,
  'repeated-punct': /[?!]{2,}/,
  'space-before-punct': /\S\s[,;:!?](?:\s|$)/,
  'casual-first-word': /^\W*(?:also|and|but|so|yeah|yep|nah|hey|ok|okay|oh)\b/i,
}

const lineCount = (t: string) => t.split('\n').filter((l) => l.trim()).length
const bulletCount = (t: string) => t.split('\n').filter((l) => /^\s*([-*•]|\d+\.)\s/.test(l)).length
const STRUCTURE: Record<string, (t: string) => boolean> = {
  'single-line': (t) => lineCount(t) === 1,
  'multi-line': (t) => lineCount(t) >= 2,
  'many-lines': (t) => lineCount(t) >= 5,
  bullets: (t) => bulletCount(t) >= 2,
}
const ID = /\b[A-Z][A-Z0-9]+-\d+\b|#\d+\b|\/pull\/\d+/

const symbols = (t: string): string[] => t.match(/\p{Extended_Pictographic}/gu) ?? []

function has(text: string, kind: Marker['kind'], pattern: string): boolean {
  if (kind === 'feature') return FEATURES[pattern]?.test(text.trim()) ?? false
  if (kind === 'structure') return STRUCTURE[pattern.split(':')[1]]?.(text.trim()) ?? false
  return text.includes(pattern)
}

function keysOf(text: string): string[] {
  const out = Object.keys(FEATURES).filter((k) => FEATURES[k].test(text.trim())).map((k) => `feature ${k}`)
  for (const w of new Set(symbols(text))) out.push(`token ${w}`)
  return out
}

function weigh(h: number, a: number, hn: number, an: number): number {
  const w = Math.log(((h + 1) / (hn + 2)) / ((a + 1) / (an + 2)))
  return Math.round(Math.min(WEIGHT_CAP, w) * 1000) / 1000
}

function count(texts: readonly string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of texts) for (const k of keysOf(t)) m.set(k, (m.get(k) ?? 0) + 1)
  return m
}

function build(hc: Map<string, number>, ac: Map<string, number>, hn: number, an: number): Marker[] {
  const items: Marker[] = []
  for (const [key, h] of hc) {
    if (h < MIN_SUPPORT) continue
    const a = ac.get(key) ?? 0
    const weight = weigh(h, a, hn, an)
    if (weight <= MIN_WEIGHT) continue
    const [kind, ...rest] = key.split(' ')
    items.push({ kind: kind as Marker['kind'], pattern: rest.join(' '), weight, h, a })
  }
  const feats = items.filter((i) => i.kind === 'feature')
  const rest = items.filter((i) => i.kind !== 'feature').sort((x, y) => y.weight - x.weight).slice(0, MAX_TOKENS)
  return [...feats, ...rest]
}

function pickThreshold(human: readonly string[], ai: readonly string[], m: Markers): number {
  const hs = human.map((t) => humanScore(t, m).score)
  const as = ai.map((t) => humanScore(t, m).score)
  for (const t of [...new Set(hs)].sort((x, y) => x - y)) {
    if (t < MIN_THRESHOLD) continue
    const tp = hs.filter((s) => s >= t).length
    const fp = as.filter((s) => s >= t).length
    if (tp / (tp + fp) >= PRECISION_TARGET) return Math.round(t * 1000) / 1000
  }
  return 1.01
}

export function learnMarkers(human: readonly string[], ai: readonly string[]): Markers {
  const m: Markers = {
    threshold: DEFAULT_THRESHOLD,
    humanN: human.length,
    aiN: ai.length,
    items: build(count(human), count(ai), human.length, ai.length),
  }
  m.threshold = pickThreshold(human, ai, m)
  return m
}

export function updateMarkers(m: Markers, newHuman: readonly string[], newAi: readonly string[] = []): Markers {
  const humanN = m.humanN + newHuman.length
  const aiN = m.aiN + newAi.length
  const known = new Set(m.items.map((i) => `${i.kind} ${i.pattern}`))
  const items: Marker[] = []
  for (const i of m.items) {
    if (i.kind === 'structure') {
      items.push(i)
      continue
    }
    const h = i.h + newHuman.filter((t) => has(t, i.kind, i.pattern)).length
    const a = i.a + newAi.filter((t) => has(t, i.kind, i.pattern)).length
    if (h >= MIN_SUPPORT) items.push({ ...i, weight: weigh(h, a, humanN, aiN), h, a })
  }
  const hc = new Map([...count(newHuman)].filter(([k, n]) => !known.has(k) && n >= MIN_SUPPORT + 1))
  return { ...m, humanN, aiN, items: [...items, ...build(hc, count(newAi), humanN, aiN)] }
}

export function learnStructure(sends: readonly { audience: Audience; text: string }[], ai: readonly string[]): Marker[] {
  const items: Marker[] = []
  for (const audience of new Set(sends.map((s) => s.audience))) {
    const hs = sends.filter((s) => s.audience === audience).map((s) => s.text.trim())
    for (const [f, test] of Object.entries(STRUCTURE)) {
      const h = hs.filter(test).length
      if (h < MIN_SUPPORT) continue
      const a = ai.filter((t) => test(t.trim())).length
      const weight = weigh(h, a, hs.length, ai.length)
      if (weight > MIN_WEIGHT) items.push({ kind: 'structure', pattern: `${audience}:${f}`, weight, h, a })
    }
  }
  return items
}

export function parseMarkers(md: string): Markers | null {
  const at = md.search(/^## Markers\s*$/m)
  const body = at < 0 ? md : md.slice(at).replace(/^## Markers\s*\n/, '').split(/^## /m)[0]
  const num = (k: string) => {
    const r = body.match(new RegExp(`^${k}:\\s*(-?[\\d.]+)\\s*$`, 'm'))
    return r ? Number(r[1]) : null
  }
  const threshold = num('threshold')
  if (threshold === null) return null
  const items: Marker[] = []
  for (const line of body.split('\n')) {
    const r = line.match(/^- (feature|token|structure) (\S+) (-?[\d.]+) (\d+) (\d+)\s*$/)
    if (r && !(r[1] === 'token' && /\p{L}/u.test(r[2]))) items.push({ kind: r[1] as Marker['kind'], pattern: r[2], weight: Number(r[3]), h: Number(r[4]), a: Number(r[5]) })
  }
  return { threshold, humanN: num('humanN') ?? 0, aiN: num('aiN') ?? 0, items }
}

export function renderMarkers(m: Markers): string {
  return [
    '## Markers',
    `threshold: ${m.threshold}`,
    `humanN: ${m.humanN}`,
    `aiN: ${m.aiN}`,
    ...m.items.map((i) => `- ${i.kind} ${i.pattern} ${i.weight} ${i.h} ${i.a}`),
    '',
  ].join('\n')
}

function idBulletWall(t: string): boolean {
  const bullets = t.split('\n').filter((l) => /^\s*([-*•]|\d+\.)\s/.test(l))
  return bullets.length >= 3 && bullets.filter((b) => ID.test(b)).length * 2 > bullets.length
}

export function humanScore(text: string, markers?: Markers, audience?: Audience, whole = text): { score: number; signals: string[] } {
  const t = text.trim()
  const signals: string[] = []
  let score = 0.5
  const add = (name: string, delta: number) => {
    signals.push(name)
    score += delta
  }
  const sentences = t.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean)
  if (/^(hi|hello|dear|good (morning|afternoon|evening))\b/i.test(t)) add('formal', -0.35)
  if (idBulletWall(whole)) add('id-bullet-wall', -0.35)
  if (sentences.filter((s) => /^[A-Z].*[.!?]$/.test(s)).length >= 2) add('punctuated', -0.2)
  if (/[\u2014\u201C\u201D\u2018\u2019]/.test(t)) add('em-dash-or-curly', -0.15)
  if (/\*\*[^*]+\*\*|__[^_]+__|`[^`]+`/.test(t)) add('markdown', -0.15)
  const veto = signals.length > 0
  for (const i of markers?.items ?? []) {
    if (i.kind === 'structure' ? audience && i.pattern.startsWith(`${audience}:`) && has(whole, i.kind, i.pattern) : has(t, i.kind, i.pattern)) add(`${i.kind}:${i.pattern}`, i.weight)
  }
  return { score: Math.min(veto ? 0.5 : 1, Math.max(0, score)), signals }
}

export interface AiIndex { shingles: Set<number>; texts: readonly string[] }

const wordsOf = (t: string): string[] => normalise(t).replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(' ').filter(Boolean)

function shingles(ws: readonly string[]): number[] {
  const out: number[] = []
  for (let i = 0; i + 3 <= ws.length; i++) {
    let h = 0x811c9dc5
    for (const c of ws.slice(i, i + 3).join(' ')) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0
    out.push(h)
  }
  return out
}

const MAX_TEXT_CHARS = 20000
const MAX_INDEX_TEXTS = 5000

export function buildIndex(outputs: readonly { text: string; ts: string }[]): AiIndex {
  const set = new Set<number>()
  const texts: string[] = []
  for (const o of outputs) {
    if (o.text.length > MAX_TEXT_CHARS) continue
    const ws = wordsOf(o.text)
    for (const h of shingles(ws)) set.add(h)
    if (texts.length < MAX_INDEX_TEXTS) texts.push(` ${ws.join(' ')} `)
  }
  return { shingles: set, texts }
}

export function containment(text: string, index: AiIndex): number {
  const ws = wordsOf(text)
  const sh = shingles(ws)
  if (sh.length < 3) {
    if (ws.length === 0) return 0
    const needle = ` ${ws.join(' ')} `
    return index.texts.some((t) => t.includes(needle)) ? 1 : 0
  }
  return sh.filter((h) => index.shingles.has(h)).length / sh.length
}

export function paragraphs(text: string): string[] {
  const chunks: string[] = []
  let cur: string[] = []
  const flush = () => {
    if (cur.length) chunks.push(cur.join('\n').trim())
    cur = []
  }
  for (const line of text.split('\n')) {
    if (!line.trim()) flush()
    else {
      if (/^\s*([-*•]|\d+\.)\s/.test(line)) flush()
      cur.push(line)
    }
  }
  flush()
  const out: string[] = []
  let carry = ''
  for (const c of chunks) {
    const p = carry ? `${carry}\n${c}` : c
    if (p.split(/\s+/).length < 3) {
      if (out.length && !carry) out[out.length - 1] += `\n${p}`
      else carry = p
    } else {
      out.push(p)
      carry = ''
    }
  }
  if (carry) out.length ? (out[out.length - 1] += `\n${carry}`) : out.push(carry)
  return out
}

export interface ParagraphResult { text: string; label: Label; sim: number; containment: number; score: number; signals: string[] }

function judge(
  text: string,
  ts: string,
  candidates: readonly AgentWrite[],
  index: AiIndex | null,
  coverageFrom: string | null,
  markers?: Markers,
  audience?: Audience,
  whole = text,
): ParagraphResult {
  const at = Date.parse(ts)
  const sim = bestSimilarity(text, candidates, at)?.s ?? 0
  const cont = index ? containment(text, index) : 0
  const { score, signals } = humanScore(text, markers, audience, whole)
  const done = (label: Label): ParagraphResult => ({ text, label, sim, containment: cont, score, signals })
  if (sim >= AI_SIM || cont >= CONTAIN_AI) return done('ai')
  if (Math.max(sim, cont) >= MIXED_SIM) return done('mixed')
  if (coverageFrom !== null && at < Date.parse(coverageFrom)) return done(score >= PRE_COVERAGE_MIN ? 'human' : 'unsure')
  return done(score >= (markers?.threshold ?? DEFAULT_THRESHOLD) ? 'human' : 'unsure')
}

export function classify(
  text: string,
  ts: string,
  candidates: readonly AgentWrite[],
  coverageFrom: string | null,
  markers?: Markers,
): { label: Label; sim: number; score: number; signals: string[] } {
  const { label, sim, score, signals } = judge(text, ts, candidates, null, coverageFrom, markers)
  return { label, sim, score, signals }
}

export function classifyItem(
  text: string,
  ts: string,
  candidates: readonly AgentWrite[],
  index: AiIndex,
  coverageFrom: string | null,
  markers?: Markers,
  audience?: Audience,
): { label: Label; paragraphs: ParagraphResult[] } {
  const whole = judge(text, ts, [], null, coverageFrom, markers, audience)
  const ps = paragraphs(text).map((p) => judge(p, ts, candidates, index, coverageFrom, markers, audience, text))
    .map((p) => (whole.label === 'human' && p.label === 'unsure' && p.score >= 0.5 ? { ...p, label: 'human' as const } : p))
  const n = (l: Label) => ps.filter((p) => p.label === l).length
  let label: Label = 'unsure'
  if (ps.length && n('human') === ps.length) label = 'human'
  else if (ps.length && n('ai') === ps.length) label = 'ai'
  else if (n('human') > 0 && n('ai') + n('mixed') > 0) label = 'mixed'
  return { label, paragraphs: ps }
}

export interface Judged { pid: string; label: 'human' | 'ai' | 'unsure'; reason: string }

export function finalLabel(p: ParagraphResult, judged: Judged | undefined): Label {
  if (p.label === 'ai' || p.label === 'mixed') return p.label
  return judged ? judged.label : p.label
}

export function needsJudge(p: ParagraphResult): boolean {
  if (p.label === 'ai' || p.label === 'mixed') return false
  return p.label === 'unsure' || (p.score >= 0.35 && p.score <= 0.75)
}

type Row = { text: string; label: 'human' | 'ai'; judged?: Judged['label'] }

function table(rows: readonly Row[], pred: (r: Row) => boolean): string {
  let tp = 0
  let fn = 0
  let fp = 0
  let tn = 0
  for (const r of rows) {
    const p = pred(r)
    if (r.label === 'human') p ? tp++ : fn++
    else p ? fp++ : tn++
  }
  const ratio = (n: number, d: number) => (d === 0 ? 0 : n / d).toFixed(2)
  return [
    '            pred human  pred not',
    `actual human    ${tp}           ${fn}`,
    `actual ai       ${fp}           ${tn}`,
    `precision(human) = ${ratio(tp, tp + fp)}  recall(human) = ${ratio(tp, tp + fn)}`,
  ].join('\n')
}

export function evaluate(rows: readonly Omit<Row, 'judged'>[], markers?: Markers): string {
  const t = markers?.threshold ?? DEFAULT_THRESHOLD
  return table(rows, (r) => humanScore(r.text, markers).score >= t)
}

export function evaluateBoth(rows: readonly Row[], markers?: Markers): string {
  const t = markers?.threshold ?? DEFAULT_THRESHOLD
  const heur = (r: Row) => humanScore(r.text, markers).score >= t
  return [
    'heuristic only',
    table(rows, heur),
    'heuristic + judge',
    table(rows, (r) => (r.judged ? r.judged === 'human' : heur(r))),
  ].join('\n')
}
