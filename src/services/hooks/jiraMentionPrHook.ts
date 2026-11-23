import { searchPrs, gh, type FoundPr } from './github'
import { repoPathByName } from './repoMatch'
import { orgAllowed, PR_URL_RE, reviewInstruction } from './slackPrReviewHook'
import { loadConfig, lookbackMin } from './config'
import { skipPendingReviews } from './reviewGuard'
import type { Trigger, TriggerEvent } from './types'

export function mentionsToEvents(
  prs: FoundPr[],
  login: string,
  now = Date.now(),
  allowedOrgs = loadConfig().allowedGithubOrgs,
  resolveRepo: (name: string) => string | undefined = repoPathByName
): TriggerEvent[] {
  const since = now - lookbackMin('jira-mention-pr') * 60 * 1000
  const events = prs.flatMap((pr): TriggerEvent[] => {
    if (!(Number(pr.ts) * 1000 >= since) || pr.author === login) return []
    const match = PR_URL_RE.exec(pr.url.trim())
    if (!match) return []
    const [url, org, repo, number] = match
    const repoHint = orgAllowed(org, allowedOrgs) ? resolveRepo(repo) : undefined
    if (!repoHint) return []
    return [
      {
        source: 'jira-mention-pr',
        id: url,
        title: `PR mention: ${org}/${repo}#${number}`,
        context: reviewInstruction(url),
        repoHint,
        action: 'session-command',
        details: { type: 'PR mention', url }
      }
    ]
  })
  return events.filter((e, i) => events.findIndex((x) => x.id === e.id) === i)
}

export const jiraMentionPrHook: Trigger = {
  name: 'jira-mention-pr',
  script: 'gh search prs --mentions=@me --state=open',
  async poll(): Promise<TriggerEvent[]> {
    const login = (await gh(['api', 'user', '--jq', '.login'])).trim()
    return skipPendingReviews('jira-mention-pr', mentionsToEvents(await searchPrs('--mentions=@me'), login))
  }
}
