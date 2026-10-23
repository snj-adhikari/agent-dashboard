import { trackedFetch as fetch } from './progress'
import type { GraphResponse, HistoryResponse, HookStatusResponse, ServiceSettings, Settings, SetupStatus } from './types'

interface ApiResult {
  ok: boolean
  error?: string
  [k: string]: unknown
}

async function postJson<T extends ApiResult = ApiResult>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return r.json()
}

export interface RemoveResult {
  path: string
  ok: boolean
  error?: string
}

export interface InactiveWorktree {
  path: string
  repo: string
  branch?: string
  dirty: string
  unpushed: string
}

export const api = {
  graph: (expandedRepoIds: string[] = []): Promise<GraphResponse> =>
    fetch('/api/graph' + (expandedRepoIds.length ? `?expanded=${expandedRepoIds.join(',')}` : '')).then((r) => r.json()),
  terminate: (pid: number) => postJson('/api/terminate', { pid }),
  removeWorktree: (path: string, force = false) => postJson('/api/remove-worktree', { path, force }),
  removeWorktrees: (paths: string[], force = false) =>
    postJson<ApiResult & { results: RemoveResult[] }>('/api/remove-worktrees', { paths, force }),
  worktreeStatus: (path: string): Promise<{ ok: boolean; status?: string; unpushed?: string }> =>
    fetch('/api/worktree-status?path=' + encodeURIComponent(path)).then((r) => r.json()),
  inactiveWorktrees: (): Promise<{ ok: boolean; worktrees: InactiveWorktree[]; kept: { path: string; reason: string }[] }> =>
    fetch('/api/worktrees/inactive').then((r) => r.json()),
  mongoStatus: (): Promise<{ ok: boolean; up: boolean; error?: string }> => fetch('/api/mongo/status').then((r) => r.json()),
  restartMongo: () => postJson('/api/mongo/restart', {}),
  send: (ref: string, text: string, surface?: string) => postJson('/api/send', { ref, text, surface }),
  screen: (ref: string, surface?: string): Promise<{ ok: boolean; screen?: string; error?: string }> =>
    fetch('/api/screen?ref=' + encodeURIComponent(ref) + (surface ? '&surface=' + encodeURIComponent(surface) : '')).then((r) => r.json()),
  newSession: (repoPath: string, branch: string) => postJson('/api/new-session', { repoPath, branch }),
  history: (range: 'day' | 'week' | 'month'): Promise<HistoryResponse> =>
    fetch('/api/history?range=' + range).then((r) => r.json()),
  hookStatus: (): Promise<HookStatusResponse> => fetch('/api/hook-status').then((r) => r.json()),
  startJiraTicket: (key: string) =>
    postJson<ApiResult & { queued?: boolean; reason?: string }>('/api/hooks/jira/start', { key }),
  importPlugin: (name: string) => postJson<ApiResult & { path?: string }>('/api/plugin/import', { name }),
  runQueued: (id?: string) => postJson('/api/hooks/queue/run', { id }),
  setHookEnabled: (name: string, enabled: boolean) =>
    postJson(`/api/hooks/${encodeURIComponent(name)}/enabled`, { enabled }),
  setHookInterval: (name: string, minutes: number) =>
    postJson(`/api/hooks/${encodeURIComponent(name)}/interval`, { minutes }),
  settings: (): Promise<Partial<Settings>> =>
    fetch('/api/settings').then((r) => r.json()).then((j) => j.settings ?? {}),
  saveSettings: (patch: Partial<Settings>) => postJson<ApiResult & { settings?: Partial<Settings> }>('/api/settings', patch),
  setupStatus: (): Promise<SetupStatus> => fetch('/api/setup/status').then((r) => r.json()),
  checkDir: (path: string) => postJson<ApiResult & { exists: boolean; repoCount: number }>('/api/setup/check-dir', { path }),
  generateService: (service?: ServiceSettings, secrets?: Record<string, string>) =>
    postJson<ApiResult & { path: string; plist: string; commands: string[]; note?: string }>('/api/setup/service/generate', { service, secrets }),
  tailscaleSetup: (): Promise<{ ok: boolean; installed: boolean; running: boolean; host: string; serving: boolean }> =>
    fetch('/api/setup/tailscale').then((r) => r.json()),
  publishToTailnet: () => postJson<ApiResult & { link?: string }>('/api/setup/tailscale/publish', {}),
  installService: (secrets?: Record<string, string>) => postJson<ApiResult & { output?: string }>('/api/setup/service/install', { secrets })
}
