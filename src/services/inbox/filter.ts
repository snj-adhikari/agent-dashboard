import { INJECTION, MED, heavyReasons, scan } from '../../shared/injection'

export type Verdict = 'pr-review' | 'pr-review-check' | 'risky' | 'heavy' | 'other'

export interface Notification {
  source: string
  title: string
  subtitle?: string
  body: string
}

export interface Classified {
  verdict: Verdict
  reasons: string[]
  urls: string[]
  jira: boolean
}

export const DEFAULT_GITHUB_ORGS = ['example-org']
const MAX_PR_LINKS = 5
const PR_LINK = /https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/pull\/(\d+)/g
const CUT_LINK = /github\.com\/\S*(…|\.\.\.)|github\.com\/[^\s/]*\/?[^\s/]*\/?(pull\/?)?$/i
const REVIEW_ASK = /\b(pr|pull request) review\b|\breview (please|pls|plz)\b|\b(can|could) you\b.{0,60}\breview\b|\bplease review\b|\btake a look\b/i
const ISSUE_KEY = /\b[A-Z][A-Z0-9]+-\d+\b/
const MENTION = /@\w|\bmentioned you\b/i

/** Canonical PR links (no trailing path, query or punctuation), de-duplicated, with their org. */
export function prLinks(text: string): { url: string; org: string }[] {
  const seen = new Map<string, string>()
  for (const [, org, repo, n] of text.matchAll(PR_LINK)) seen.set(`https://github.com/${org}/${repo}/pull/${n}`, org)
  return [...seen].map(([url, org]) => ({ url, org }))
}

export function isJira(n: Notification, text: string): boolean {
  return /\bjira\b/i.test(`${n.title} ${n.subtitle || ''}`) || (ISSUE_KEY.test(text) && MENTION.test(text))
}

/** Risky and heavy win over a PR review, so neither is ever auto-run. */
export function classify(n: Notification, allowedOrgs: string[] = []): Classified {
  const text = [n.title, n.subtitle, n.body].filter(Boolean).join('\n')
  const orgs = (allowedOrgs.length ? allowedOrgs : DEFAULT_GITHUB_ORGS).map((o) => o.toLowerCase())
  const links = prLinks(text)
  const urls = links.filter((l) => orgs.includes(l.org.toLowerCase())).map((l) => l.url)
  const jira = isJira(n, text)
  const injection = scan(text, INJECTION)
  const heavy = [...heavyReasons(text), ...(links.length > MAX_PR_LINKS ? [`${links.length} PR links`] : [])]
  const result = (verdict: Verdict, reasons: string[]): Classified => ({ verdict, reasons, urls, jira })

  if (injection.score >= MED) return result('risky', [...injection.hits, ...heavy])
  if (heavy.length) return result('heavy', heavy)
  const ask = REVIEW_ASK.test(text)
  if (ask && urls.length) return result('pr-review', ['review ask with a PR link'])
  if (ask && links.length) return result('other', [`org not allowed: ${[...new Set(links.map((l) => l.org))].join(', ')}`])
  if (ask) return result('pr-review-check', [CUT_LINK.test(text) ? 'PR link cut off in the preview' : 'no PR link in the preview'])
  return result('other', [])
}
