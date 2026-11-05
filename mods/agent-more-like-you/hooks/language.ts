import type { Audience } from './audience'

export interface Chat { channel: string; kind: string; people: string[] }
export interface Person { id: string; name: string }
export interface Detector { scripts: [number, number][]; sure: string[]; maybe: string[]; minHits: number; normalise: [string, string][] }
export interface Language { people: Person[]; label: string; detect?: Detector }
export interface Languages { englishOnly: Audience[]; englishOnlyPeople: Person[]; chats: Chat[]; languages: Record<string, Language> }
export interface Detected { id: string; label: string; detect: Detector }

type Obj = Record<string, unknown>

const AUDIENCES: Audience[] = ['slack-dm', 'slack-channel', 'jira', 'confluence', 'github-pr']
const DEFAULT_ENGLISH_ONLY: Audience[] = ['jira', 'confluence', 'github-pr', 'slack-channel']
const MAX_WORDS = 2000
const MAX_WORD = 64
const MAX_RANGES = 32

const strings = (v: unknown, skip = ''): string[] =>
  typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => (k === skip ? [] : strings(x, skip))) : []
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

const people = (v: unknown): Person[] =>
  (Array.isArray(v) ? v : []).flatMap((x): Person[] => {
    if (typeof x === 'string') return [{ id: x, name: x }]
    const o = x as Obj | null
    return o && typeof o === 'object' ? [{ id: typeof o.slackId === 'string' ? o.slackId : '', name: typeof o.name === 'string' ? o.name : '' }] : []
  })
const find = (ps: Person[], key: string): Person | undefined => (key ? ps.find((p) => p.id === key || p.name === key) : undefined)

const capped = (v: unknown): string[] => list(v).filter((w) => w.length <= MAX_WORD).slice(0, MAX_WORDS)

function parseDetect(v: unknown): Detector | undefined {
  const o = v as Obj | null
  if (!o || typeof o !== 'object' || Array.isArray(o)) return undefined
  const pairs = (x: unknown): unknown[][] => (Array.isArray(x) ? x.filter((p): p is unknown[] => Array.isArray(p) && p.length === 2).slice(0, MAX_RANGES) : [])
  const scripts = pairs(o.scripts).flatMap(([a, b]): [number, number][] => {
    const lo = parseInt(String(a), 16)
    const hi = parseInt(String(b), 16)
    return Number.isNaN(lo) || Number.isNaN(hi) ? [] : [[lo, hi]]
  })
  const normalise = pairs(o.normalise).flatMap(([a, b]): [string, string][] => (typeof a === 'string' && a && typeof b === 'string' ? [[a, b]] : []))
  const minHits = typeof o.minHits === 'number' && o.minHits >= 1 ? Math.floor(o.minHits) : 2
  return { scripts, sure: capped(o.sure), maybe: capped(o.maybe), minHits, normalise }
}

export function parseDetector(name: string, text: string): Detected | null {
  try {
    const j = JSON.parse(text) as Obj
    const detect = parseDetect(j?.detect)
    if (!detect) return null
    const id = typeof j.id === 'string' && j.id ? j.id : name.replace(/\.json$/, '')
    return { id, label: typeof j.label === 'string' && j.label ? j.label : id, detect }
  } catch {
    return null
  }
}

export const MAX_DETECTOR_FILES = 64

export function readLanguages(text: string | null): Languages {
  const none: Languages = { englishOnly: [...AUDIENCES], englishOnlyPeople: [], chats: [], languages: {} }
  try {
    const j = JSON.parse(text ?? '') as Obj
    if (!j || typeof j !== 'object' || Array.isArray(j)) return none
    const only = Array.isArray(j.englishOnly) ? list(j.englishOnly).filter((a): a is Audience => AUDIENCES.includes(a as Audience)) : DEFAULT_ENGLISH_ONLY
    const chats = (Array.isArray(j.chats) ? (j.chats as Obj[]) : [])
      .filter((c) => c && typeof c.channel === 'string')
      .map((c) => ({ channel: c.channel as string, kind: typeof c.kind === 'string' ? c.kind : '', people: list(c.people) }))
    const languages: Record<string, Language> = {}
    const map = j.languages && typeof j.languages === 'object' && !Array.isArray(j.languages) ? (j.languages as Record<string, Obj | null>) : {}
    for (const [id, v] of Object.entries(map)) {
      if (!v || typeof v !== 'object') continue
      languages[id] = { people: people(v.people), label: typeof v.label === 'string' && v.label ? v.label : id, detect: parseDetect(v.detect) }
    }
    const legacy = people(j.nepaliPeople)
    if (legacy.length) {
      const ne = (languages['ne-roman'] ??= { people: [], label: 'ne-roman' })
      const seen = new Set(ne.people.map((p) => `${p.id}|${p.name}`))
      ne.people = [...ne.people, ...legacy.filter((p) => !seen.has(`${p.id}|${p.name}`))]
    }
    return { englishOnly: only, englishOnlyPeople: people(j.englishOnlyPeople), chats, languages }
  } catch {
    return none
  }
}

export function detects(text: string, detectors: readonly Detected[]): string | null {
  const prose = text
    .replace(/```[\s\S]*?```|`[^`\n]*`/g, ' ')
    .replace(/\b[a-z][\w+.-]*:\/\/\S+/gi, ' ')
    .split(/\s+/)
    .filter((t) => !/[/\\_.\d@#]|[a-z][A-Z]/.test(t))
  for (const { id, detect: d } of detectors) {
    if ([...text].some((ch) => d.scripts.some(([lo, hi]) => ch.codePointAt(0)! >= lo && ch.codePointAt(0)! <= hi))) return id
    const sure = new Set(d.sure)
    const maybe = new Set(d.maybe)
    const hits = new Set<string>()
    let hasSure = false
    for (const t of prose) {
      const w = d.normalise.reduce((acc, [from, to]) => acc.replaceAll(from, to), t.toLowerCase()).replace(/[^a-z]/g, '')
      if (sure.has(w)) {
        hits.add(w)
        hasSure = true
      } else if (maybe.has(w)) hits.add(w)
    }
    if (hasSure && hits.size >= d.minHits) return id
  }
  return null
}

const allPeople = (langs: Languages): Person[] => Object.values(langs.languages).flatMap((l) => l.people)

export function participantsOf(
  channel: string,
  self: string | undefined,
  langs: Languages,
  captures: readonly { channel?: string; authorId?: string }[],
): string[] | null {
  const isSelf = (k: string) => k === self || (!!self && allPeople(langs).some((p) => (p.id === k || p.name === k) && p.id === self))
  const others = (ids: string[]) => [...new Set(ids)].filter((id) => id && !isSelf(id))
  const chat = langs.chats.find((c) => c.channel === channel)
  if (chat) return others(chat.people)
  if (/^U/.test(channel)) return [channel]
  const found = others(captures.filter((c) => c.channel === channel).map((c) => c.authorId ?? ''))
  return /^D/.test(channel) && found.length === 1 ? found : null
}

export function decide(audience: Audience | 'english-only', channel: string, participants: string[] | null, langs: Languages): string {
  const direct = audience === 'slack-dm' || langs.chats.some((c) => c.channel === channel && (c.kind === 'dm' || c.kind === 'group-dm'))
  if (!direct || !participants?.length || langs.englishOnly.includes('slack-dm')) return 'english'
  const barred = (p: string, who: Person) => !!find(langs.englishOnlyPeople, p) || !!find(langs.englishOnlyPeople, who.id) || !!find(langs.englishOnlyPeople, who.name)
  const ids = Object.keys(langs.languages).sort()
  return (
    ids.find((id) =>
      participants.every((p) => {
        const who = find(langs.languages[id].people, p)
        return !!who && !barred(p, who)
      }),
    ) ?? 'english'
  )
}

export function englishOnlyWrite(tool: string, input: Obj): Audience | null {
  const name = /execute(Write|Destructive)$/.test(tool) && typeof input.name === 'string' ? input.name : tool
  if (tool === 'Bash') {
    const c = typeof input.command === 'string' ? input.command : ''
    return /\bgh\s+(pr|issue)\s+(create|edit|comment|review|merge)\b/.test(c) && /\s(--(title|body|body-file)|-[tbF])[\s=]/.test(c) ? 'github-pr' : null
  }
  const verb = name.split('__').pop() ?? name
  if (!/^(get|search|lookup)/i.test(verb) && /(create|edit|add|update|transition|comment|worklog)/i.test(verb)) {
    if (/confluence/i.test(verb)) return 'confluence'
    if (/jira/i.test(verb)) return 'jira'
  }
  if (/slack_(create|update)_canvas$/.test(name)) return 'slack-channel'
  return null
}

export const draftText = (input: Obj): string => strings(input, 'tool').join('\n')
