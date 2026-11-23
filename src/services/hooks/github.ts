import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export async function gh(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('gh', args, { encoding: 'utf8', timeout: 30_000 })
  return stdout
}

export interface FoundPr {
  url: string
  /** Epoch seconds of the last update. */
  ts: string
  author: string
}

/** Open PRs matching one `gh search prs` filter such as `--review-requested=@me`; read-only, no model involved. */
export async function searchPrs(filter: string, search = gh): Promise<FoundPr[]> {
  const out = await search(['search', 'prs', filter, '--state=open', '--limit=50', '--json', 'url,updatedAt,author'])
  return (JSON.parse(out) as { url: string; updatedAt: string; author?: { login?: string } }[]).map((p) => ({
    url: p.url,
    ts: String(Date.parse(p.updatedAt) / 1000),
    author: p.author?.login || ''
  }))
}
