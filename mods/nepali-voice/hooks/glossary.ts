import type { EngineInterface as Engine } from 'claude-code'

export interface Learnt { phrase: string; meaning: string; date: string; source: string; section: 'learnt' | 'heard' }
export interface Pending { phrase: string; meaning?: string; correcting?: boolean }

const LEARNT = 'learnt'
const HEARD = 'heard from others'
const LOCK_STALE = 30 * 60_000
const MAX_PHRASE = 200
const CORRECTION = /\b(no|nope|hoina|matlab|galat)\b|i meant|not that/i

export const normalisePhrase = (p: string): string =>
  p.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
const heading = (l: string) => /^##\s+(.+?)\s*$/.exec(l)?.[1].toLowerCase() ?? null
const isSep = (l: string | undefined) => !!l && /^\s*\|[\s|:-]+\|?\s*$/.test(l) && l.includes('-')

export function glossaryPhrases(md: string | null): string[] {
  if (!md) return []
  const lines = md.split('\n')
  const out: string[] = []
  lines.forEach((l, i) => {
    const bullet = /^\s*[-*]\s+(.+?)\s+—\s/.exec(l)
    if (bullet) return void out.push(oneLine(bullet[1]))
    const quoted = /^\s*[-*]\s+[^"“”]*?:\s*(["“].*)$/.exec(l)
    if (quoted) return void out.push(...[...quoted[1].matchAll(/["“]([^"“”]+)["”]/g)].map((m) => oneLine(m[1])).filter(Boolean))
    if (!l.trim().startsWith('|') || isSep(l) || isSep(lines[i + 1])) return
    for (const v of l.trim().replace(/^\|/, '').split('|')[0].split(/[/,]/)) if (oneLine(v)) out.push(oneLine(v))
  })
  return out
}

export const understoodAs = (answer: string): string | null => /^\s*Understood as:\s*(\S.*?)\s*$/im.exec(answer)?.[1] ?? null

export const isCorrection = (prompt: string): boolean => CORRECTION.test(prompt)

export function parseFix(args: string): { phrase: string; meaning: string } | null {
  const m = /^\s*(?:fix\s+)?(.+?)\s*=\s*(.+?)\s*$/s.exec(args)
  return m && oneLine(m[1]) && oneLine(m[2]) ? { phrase: oneLine(m[1]), meaning: oneLine(m[2]) } : null
}

type Ev = { kind: 'prompt'; text: string; nepali: boolean } | { kind: 'answer'; text: string }

export function learnStep(
  p: Pending | null,
  ev: Ev,
  date: string,
): { pending: Pending | null; learn: Learnt[]; correction?: { phrase: string; from: string; to: string } } {
  if (ev.kind === 'answer') {
    const u = understoodAs(ev.text)
    if (!p || !u) return { pending: p, learn: [] }
    if (p.correcting && p.meaning) {
      return {
        pending: null,
        learn: [{ phrase: p.phrase, meaning: u, date, source: 'typed', section: 'learnt' }],
        correction: { phrase: p.phrase, from: p.meaning, to: u },
      }
    }
    return { pending: p.meaning ? p : { ...p, meaning: u }, learn: [] }
  }
  const text = oneLine(ev.text)
  const next = ev.nepali && text && text.length <= MAX_PHRASE ? { phrase: text } : null
  if (p?.meaning && !p.correcting) {
    if (isCorrection(ev.text)) return { pending: { ...p, correcting: true }, learn: [] }
    return { pending: next, learn: [{ phrase: p.phrase, meaning: p.meaning, date, source: 'typed', section: 'learnt' }] }
  }
  return { pending: next, learn: [] }
}

const line = (r: Learnt) => `- ${oneLine(r.phrase)} — ${oneLine(r.meaning)} — ${r.date} — ${r.source}`

function sectionEnd(lines: string[], at: number): number {
  let end = at
  for (let i = at + 1; i < lines.length && heading(lines[i]) === null; i++) if (lines[i].trim()) end = i
  return end
}

export function foldGlossary(md: string, rows: readonly Learnt[]): string | null {
  const lines = md.split('\n')
  const at = (name: string) => lines.flatMap((l, i) => (heading(l)?.startsWith(name) ? [i] : []))
  if (at(LEARNT).length > 1 || at(HEARD).length > 1) return null
  const seen = new Set(glossaryPhrases(md).map(normalisePhrase))
  const fresh = rows.filter((r) => {
    const k = normalisePhrase(r.phrase)
    if (!k || !oneLine(r.meaning) || seen.has(k)) return false
    seen.add(k)
    return true
  })
  if (!fresh.length) return md
  const add = (name: string, title: string, section: Learnt['section']) => {
    const mine = fresh.filter((r) => r.section === section).map(line)
    if (!mine.length) return
    const [idx] = at(name)
    if (idx !== undefined) return void lines.splice(sectionEnd(lines, idx) + 1, 0, ...mine)
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
    lines.push('', `## ${title}`, '', ...mine, '')
  }
  add(HEARD, 'Heard from others', 'heard')
  add(LEARNT, 'Learnt', 'learnt')
  return lines.join('\n')
}

async function staged($: Engine, folder: string): Promise<Learnt[]> {
  const dir = `${folder}/raw`
  if (!(await $.fs.exists(dir))) return []
  const names = (await $.fs.list(dir)).map((e) => e.name).filter((n) => n.endsWith('-nepali-learnt.jsonl')).sort()
  const out: Learnt[] = []
  for (const n of names) {
    for (const l of (await $.fs.read(`${dir}/${n}`)).split('\n')) {
      try {
        const r = JSON.parse(l) as Learnt
        if (r.phrase && r.meaning && (r.section === 'learnt' || r.section === 'heard')) out.push(r)
      } catch {}
    }
  }
  return out
}

export async function stageAndFold($: Engine, folder: string, rows: readonly Learnt[]): Promise<'folded' | 'locked' | 'skipped'> {
  const now = Date.now()
  const keep = rows.filter((r) => oneLine(r.meaning ?? '') && oneLine(r.phrase ?? ''))
  if (keep.length) {
    const path = `${folder}/raw/${new Date(now).toISOString().slice(0, 10)}-nepali-learnt.jsonl`
    const prior = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
    await $.fs.write(path, `${prior && !prior.endsWith('\n') ? `${prior}\n` : prior}${keep.map((r) => JSON.stringify(r)).join('\n')}\n`)
  }
  const glossary = `${folder}/nepali-glossary.md`
  if (!(await $.fs.exists(glossary))) return 'skipped'
  const lock = `${folder}/.nepali-learn.lock`
  try {
    const l = JSON.parse(await $.fs.read(lock)) as { startedAt?: string }
    if (typeof l.startedAt === 'string' && now - Date.parse(l.startedAt) < LOCK_STALE) return 'locked'
  } catch {}
  await $.fs.write(lock, JSON.stringify({ startedAt: new Date(now).toISOString() }))
  try {
    const current = await $.fs.read(glossary)
    const out = foldGlossary(current, await staged($, folder))
    if (out === null) return 'skipped'
    if (out !== current) await $.fs.write(glossary, out)
    return 'folded'
  } finally {
    await $.fs.write(lock, '{}')
  }
}
