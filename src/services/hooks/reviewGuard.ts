import { execFile } from 'child_process'
import { promisify } from 'util'
import { PR_URL_RE } from './slackPrReviewHook'
import { log } from './logger'
import { updateStatus } from './status'
import type { TriggerEvent } from './types'

const execFileAsync = promisify(execFile)

export interface GhReview {
  user?: { login?: string }
  state?: string
}

/** GitHub only returns PENDING reviews to their author, so any PENDING review in the list is mine. */
export function hasPendingReview(reviews: GhReview[], login: string): boolean {
  return reviews.some((r) => r.state === 'PENDING' && r.user?.login === login)
}

async function gh(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('gh', args, { encoding: 'utf8', timeout: 30_000 })
  return stdout
}

export async function myPendingReview(prUrl: string): Promise<boolean> {
  const match = PR_URL_RE.exec(prUrl)
  if (!match) return false
  const [, org, repo, number] = match
  const login = (await gh(['api', 'user', '--jq', '.login'])).trim()
  const reviews = JSON.parse(await gh(['api', '--paginate', '--slurp', `repos/${org}/${repo}/pulls/${number}/reviews`])) as GhReview[][]
  return hasPendingReview(reviews.flat(), login)
}

/** Drops review events where I already hold a pending review; flags them in the Hooks panel. A failed lookup lets the review proceed. */
export async function skipPendingReviews(hook: string, events: TriggerEvent[]): Promise<TriggerEvent[]> {
  const kept: TriggerEvent[] = []
  const flags: string[] = []
  for (const event of events) {
    const url = event.details?.url
    const pending = url ? await myPendingReview(url).catch(() => false) : false
    if (pending) {
      flags.push(`pending review already on ${url}`)
      log(`${hook}: skipped ${event.id}, pending review already exists`)
    } else kept.push(event)
  }
  updateStatus(hook, { flags })
  return kept
}
