import type { Audience } from './audience'

export interface Config {
  sources: Record<'slack' | 'jira' | 'confluence' | 'github' | 'transcripts' | 'notes' | 'prompts', boolean>
  audiences: Record<Audience, boolean>
  backfillDays: number
  staleDays: number
  threshold: number | null
  notesDir: string | null
  autoRefresh: 'local' | 'full'
  judgeLimit: number
  perspective: boolean
}

type Obj = Record<string, unknown>

const bools = <K extends string>(keys: readonly K[], given: unknown, fallback: Partial<Record<K, boolean>> = {}) =>
  Object.fromEntries(
    keys.map((k) => {
      const v = (given as Obj | undefined)?.[k]
      return [k, typeof v === 'boolean' ? v : (fallback[k] ?? true)]
    }),
  ) as Record<K, boolean>

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback)

export function readConfig(text: string | null): Config {
  let raw: Obj = {}
  try {
    const v = text ? JSON.parse(text) : null
    if (v && typeof v === 'object' && !Array.isArray(v)) raw = v as Obj
  } catch {}
  const notesDir = typeof raw.notesDir === 'string' && raw.notesDir ? raw.notesDir : null
  return {
    sources: bools(['slack', 'jira', 'confluence', 'github', 'transcripts', 'notes', 'prompts'], raw.sources),
    audiences: bools(['slack-dm', 'slack-channel', 'jira', 'confluence', 'github-pr'], raw.audiences),
    backfillDays: num(raw.backfillDays, 90),
    staleDays: num(raw.staleDays, 7),
    threshold: typeof raw.threshold === 'number' && Number.isFinite(raw.threshold) ? raw.threshold : null,
    notesDir,
    autoRefresh: raw.autoRefresh === 'full' ? 'full' : 'local',
    judgeLimit: num(raw.judgeLimit, 300),
    perspective: raw.perspective !== false,
  }
}

export interface LocationCache {
  read: () => Promise<string | null>
  write: (folder: string) => Promise<void>
}

const noCache: LocationCache = { read: async () => null, write: async () => {} }

export async function resolveFolder(
  env: (k: string) => string | undefined,
  home: string,
  fetchVaultPath: (url: string) => Promise<string | null>,
  cache: LocationCache = noCache,
): Promise<{ folder: string; vaultRoot: string | null }> {
  const expand = (p: string) => (p === '~' || p.startsWith('~/') ? home + p.slice(1) : p)
  const remember = async (folder: string, vaultRoot: string | null) => {
    await cache.write(folder).catch(() => {})
    return { folder, vaultRoot }
  }
  const custom = env('MORE_LIKE_YOU_VAULT')
  if (custom) return remember(expand(custom), null)
  let root = env('VAULT_PATH') || null
  if (!root) {
    try {
      root = await fetchVaultPath(`${env('AGENT_MONITOR_URL') ?? 'http://127.0.0.1:5818'}/api/settings`)
    } catch {
      const cached = await cache.read().catch(() => null)
      if (cached) return { folder: cached, vaultRoot: null }
    }
  }
  if (root) {
    const vaultRoot = expand(root).replace(/\/$/, '')
    return remember(`${vaultRoot}/more-like-you`, vaultRoot)
  }
  return { folder: `${home}/.claude/more-like-you`, vaultRoot: null }
}
