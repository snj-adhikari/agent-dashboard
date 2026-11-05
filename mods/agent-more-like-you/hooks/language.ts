import type { Audience } from './audience'

export interface Chat { channel: string; kind: string; people: string[] }
export interface Person { id: string; name: string }
export interface Languages { englishOnly: Audience[]; nepaliPeople: Person[]; englishOnlyPeople: Person[]; chats: Chat[] }

type Obj = Record<string, unknown>

const AUDIENCES: Audience[] = ['slack-dm', 'slack-channel', 'jira', 'confluence', 'github-pr']
const DEFAULT_ENGLISH_ONLY: Audience[] = ['jira', 'confluence', 'github-pr', 'slack-channel']
const DEVANAGARI = /[ऀ-ॿ]/
const SURE = new Set(
  'chha chhu chhau chhan garchu garchau garne garnu garera gara bhayo bhane bhanera hoina chaina tapai timi hajur dhanyabad ramro kasto kina kaha yaha tyaha huncha parcha lagyo ahile bholi pani matlab'.split(' '),
)
const MAYBE = new Set('ma ho ko ra ta ke ni ki ek'.split(' '))

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

export function readLanguages(text: string | null): Languages {
  const none: Languages = { englishOnly: [...AUDIENCES], nepaliPeople: [], englishOnlyPeople: [], chats: [] }
  try {
    const j = JSON.parse(text ?? '') as Obj
    if (!j || typeof j !== 'object' || Array.isArray(j)) return none
    const only = Array.isArray(j.englishOnly) ? list(j.englishOnly).filter((a): a is Audience => AUDIENCES.includes(a as Audience)) : DEFAULT_ENGLISH_ONLY
    const chats = (Array.isArray(j.chats) ? (j.chats as Obj[]) : [])
      .filter((c) => c && typeof c.channel === 'string')
      .map((c) => ({ channel: c.channel as string, kind: typeof c.kind === 'string' ? c.kind : '', people: list(c.people) }))
    return { englishOnly: only, nepaliPeople: people(j.nepaliPeople), englishOnlyPeople: people(j.englishOnlyPeople), chats }
  } catch {
    return none
  }
}

export function hasNepali(text: string): boolean {
  if (DEVANAGARI.test(text)) return true
  const prose = text
    .replace(/```[\s\S]*?```|`[^`\n]*`/g, ' ')
    .replace(/\b[a-z][\w+.-]*:\/\/\S+/gi, ' ')
    .split(/\s+/)
    .filter((t) => !/[/\\_.\d@#]|[a-z][A-Z]/.test(t))
  const hits = new Set<string>()
  let sure = false
  for (const t of prose) {
    const w = t.toLowerCase().replace(/[^a-z]/g, '').replace(/x/g, 'ch').replace(/v/g, 'bh')
    if (SURE.has(w)) {
      hits.add(w)
      sure = true
    } else if (MAYBE.has(w)) hits.add(w)
  }
  return sure && hits.size >= 2
}

export function participantsOf(
  channel: string,
  self: string | undefined,
  langs: Languages,
  captures: readonly { channel?: string; authorId?: string }[],
): string[] | null {
  const isSelf = (k: string) => k === self || (!!self && find(langs.nepaliPeople, k)?.id === self)
  const others = (ids: string[]) => [...new Set(ids)].filter((id) => id && !isSelf(id))
  const chat = langs.chats.find((c) => c.channel === channel)
  if (chat) return others(chat.people)
  if (/^U/.test(channel)) return [channel]
  const found = others(captures.filter((c) => c.channel === channel).map((c) => c.authorId ?? ''))
  return /^D/.test(channel) && found.length === 1 ? found : null
}

export function decide(audience: Audience | 'english-only', channel: string, participants: string[] | null, langs: Languages): 'english' | 'roman-nepali' {
  const direct = audience === 'slack-dm' || langs.chats.some((c) => c.channel === channel && (c.kind === 'dm' || c.kind === 'group-dm'))
  if (!direct || !participants?.length || langs.englishOnly.includes('slack-dm')) return 'english'
  const ok = participants.every((p) => {
    const who = find(langs.nepaliPeople, p)
    return !!who && !find(langs.englishOnlyPeople, p) && !find(langs.englishOnlyPeople, who.id) && !find(langs.englishOnlyPeople, who.name)
  })
  return ok ? 'roman-nepali' : 'english'
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
