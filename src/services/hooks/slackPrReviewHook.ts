import { searchPrs } from './github'
import { repoPathByName } from './repoMatch'
import { loadConfig, lookbackMin, profileSettings } from './config'
import { skipPendingReviews } from './reviewGuard'
import type { Trigger, TriggerEvent } from './types'

export const PR_URL_RE = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/pull\/(\d+)$/

export function reviewInstruction(url: string): string {
  const skill = profileSettings().prReviewSkill.trim().replace(/^\//, '')
  return skill ? `/${skill} ${url}` : `Review this pull request and leave inline comments: ${url}`
}

export function orgAllowed(org: string, allowed = loadConfig().allowedGithubOrgs): boolean {
  return !allowed.length || allowed.includes(org)
}

interface ReviewRequest {
  prUrl: string
  ts: string
}

export function reviewRequestToEvent(req: ReviewRequest): TriggerEvent | null {
  if (!(Number(req.ts) * 1000 >= Date.now() - lookbackMin('slack-pr-review') * 60 * 1000)) return null
  return prReviewEvent(req.prUrl)
}

/** The slack-pr-review event for one PR link, with no lookback check; null for a bad link or an org not allowed. */
export function prReviewEvent(prUrl: string): TriggerEvent | null {
  const match = PR_URL_RE.exec(prUrl.trim())
  if (!match) return null
  const [url, org, repo] = match
  if (!orgAllowed(org)) return null
  return {
    source: 'slack-pr-review',
    id: url,
    title: `PR review: ${org}/${repo}#${match[3]}`,
    context: reviewInstruction(url),
    repoHint: repoPathByName(repo),
    action: 'session-command',
    details: { type: 'PR review', url }
  }
}

export const slackPrReviewHook: Trigger = {
  name: 'slack-pr-review',
  script: 'gh search prs --review-requested=@me --state=open',
  async poll(): Promise<TriggerEvent[]> {
    const requests = await searchPrs('--review-requested=@me')
    return skipPendingReviews('slack-pr-review', requests.map((r) => reviewRequestToEvent({ prUrl: r.url, ts: r.ts })).filter((e): e is TriggerEvent => e !== null))
  }
}
