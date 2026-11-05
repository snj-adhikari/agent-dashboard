import { SECTION_TITLE as TITLES, type Audience } from './audience'
import { normalise, similarity } from './score'

export interface Feedback { ts: string; audience: Audience; instruction: string; before: string; after?: string }
export interface EditPair { ts: string; audience: Audience; before: string; after: string; lengthRatio: number; removed: string[]; added: string[] }

const AUDIENCES = Object.keys(TITLES) as Audience[]
const SAME_INSTRUCTION = 0.7
const NEAR_MATCH = 0.6
const MIN_PAIRS = 3
const STOP = new Set(
  'a an and are as at be but by for from has have i if in into is it its of on or so that the their then there this to was we were will with you your not can do does just me my our they them these those than also been would should could about up out'.split(' '),
)

export function feedbackEntry(prompt: string, draft: { audience: Audience; text: string }, ts: string): Feedback {
  const entry: Feedback = { ts, audience: draft.audience, instruction: prompt, before: draft.text }
  if (similarity(prompt, draft.text) >= 0.4) entry.after = prompt
  return entry
}

const pieces = (text: string): string[] =>
  text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)

const sentences = (p: string): string[] =>
  p.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean)

function unmatched(from: string, against: string): string[] {
  const pool = pieces(against).flatMap((p) => [p, ...sentences(p)])
  const has = (s: string) => pool.some((q) => similarity(s, q) >= NEAR_MATCH)
  const out: string[] = []
  for (const p of pieces(from)) {
    if (has(p)) continue
    const ss = sentences(p)
    const missing = ss.filter((s) => !has(s))
    if (ss.length > 1 && missing.length < ss.length) out.push(...missing)
    else out.push(p)
  }
  return out
}

export function editPair(before: string, after: string): { lengthRatio: number; removed: string[]; added: string[] } {
  return {
    lengthRatio: before.length ? after.length / before.length : 1,
    removed: unmatched(before, after),
    added: unmatched(after, before),
  }
}

function kindOf(seg: string): string {
  if (/^\s*[-*•]\s/m.test(seg)) return 'bullet list'
  if (/^(hi|hello|hey|dear|good (morning|afternoon|evening))\b/i.test(seg.trim())) return 'greeting opener'
  if (/\b(thanks|thank you|cheers|regards|let me know|happy to|please reach out)\b/i.test(seg) && seg.split(/\s+/).length <= 20) return 'closing line'
  if (seg.split(/\s+/).length > 25) return 'long sentence'
  return 'other'
}

function top(items: Iterable<string>, n: number): string[] {
  const counts = new Map<string, number>()
  for (const i of items) counts.set(i, (counts.get(i) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k)
}

const words = (segs: string[]): string[] =>
  segs.flatMap((s) => normalise(s).match(/[a-z']{3,}/g) ?? []).filter((w) => !STOP.has(w))

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function foldEdits(pairs: readonly EditPair[]): Partial<Record<Audience, string[]>> {
  const out: Partial<Record<Audience, string[]>> = {}
  for (const a of AUDIENCES) {
    const ps = pairs.filter((p) => p.audience === a)
    if (ps.length < MIN_PAIRS) continue
    const ratio = median(ps.map((p) => p.lengthRatio))
    const lines = [
      ratio < 0.9
        ? `Cut drafts to about ${Math.round(ratio * 100)}% of the draft length`
        : 'Keep drafts about the same length as the draft',
    ]
    const kinds = top(ps.flatMap((p) => p.removed.map(kindOf)), 3)
    for (const k of kinds) lines.push(`Drop the ${k} when editing`)
    const rem = top(words(ps.flatMap((p) => p.removed)), 5)
    const add = top(words(ps.flatMap((p) => p.added)), 5)
    if (rem.length) lines.push(`Words often removed: ${rem.join(', ')}`)
    if (add.length) lines.push(`Words often added: ${add.join(', ')}`)
    out[a] = lines
  }
  return out
}

function instructionRules(entries: readonly Feedback[], audience: Audience): string[] {
  const groups: { text: string; n: number }[] = []
  for (const e of entries) {
    if (e.audience !== audience) continue
    const g = groups.find((x) => similarity(x.text, e.instruction) >= SAME_INSTRUCTION)
    if (g) g.n++
    else groups.push({ text: e.instruction.trim(), n: 1 })
  }
  return groups.filter((g) => g.n >= 2).map((g) => `- ${g.text.replace(/\s+/g, ' ')} (seen ${g.n})`)
}

export function foldFeedback(entries: readonly Feedback[], edits: readonly EditPair[] = []): string {
  const folded = foldEdits(edits)
  const blocks: string[] = []
  for (const a of AUDIENCES) {
    const rules = instructionRules(entries, a)
    const ed = folded[a] ?? []
    if (!rules.length && !ed.length) continue
    const parts = [`## ${TITLES[a]}`, ...rules]
    if (ed.length) parts.push('### Edits', ...ed.map((l) => `- ${l}`))
    blocks.push(parts.join('\n'))
  }
  return blocks.length ? `${blocks.join('\n\n')}\n` : ''
}

export function rulesSection(md: string, audience: Audience): string | null {
  const lines = md.split('\n')
  const start = lines.findIndex((l) => l.trim() === `## ${TITLES[audience]}`)
  if (start < 0) return null
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l))
  const body = lines.slice(start, end < 0 ? undefined : end).join('\n').trim()
  return lines.slice(start + 1, end < 0 ? undefined : end).join('').trim() ? body : null
}
