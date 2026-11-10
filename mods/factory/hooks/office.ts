import type { AgentInfo, EngineInterface as Engine } from 'claude-code'

import type { OfficeAgent, OfficeLead, OfficeStatus } from '../types'

const TEAMS: Record<string, OfficeAgent['team']> = {
  'product-analyst': 'product',
  'design-lead': 'product',
  'product-consultant': 'product',
  'tech-lead': 'tech',
  planner: 'tech',
  'reverse-engineer': 'tech',
  researcher: 'research',
  developer: 'dev',
  qa: 'qa',
}

export const teamOf = (role: string): OfficeAgent['team'] => TEAMS[role.replace(/^factory:/, '')] ?? 'research'

const fromAgent = (s: AgentInfo['status']): OfficeStatus =>
  s === 'running' || s === 'pending' ? 'working' : s === 'waiting' ? 'blocked' : s === 'idle' ? 'idle' : 'done'

/** Upserts live factory:* subagents; one that left the list has finished. */
export function mergeAgents(known: readonly OfficeAgent[], live: readonly AgentInfo[]): OfficeAgent[] {
  const now = new Map(live.filter(a => a.type.startsWith('factory:')).map(a => [a.id, a]))
  const kept = known.map(k => {
    if (k.terminal) return k
    const a = now.get(k.id)
    now.delete(k.id)
    return a ? { ...k, task: a.description.slice(0, 40), status: fromAgent(a.status) } : { ...k, status: 'done' as const }
  })
  const added = [...now.values()].map(a => ({
    id: a.id,
    team: teamOf(a.type),
    role: a.type,
    task: a.description.slice(0, 40),
    status: fromAgent(a.status),
    codename: null,
    terminal: null,
  }))
  return [...kept, ...added]
}

type HcTerminal = { address: string; state?: string; status?: unknown; labels?: Record<string, string> }

const fromHc = (t: HcTerminal): OfficeStatus => {
  if (t.state && t.state !== 'live') return 'done'
  const s = String((t.status as { state?: unknown } | undefined)?.state ?? t.status ?? '')
  return s === 'working' ? 'working' : /block|wait|perm|ask/.test(s) ? 'blocked' : 'idle'
}

/** Herdr app developers the lead opened with `hc run --label factory.lead=<lead>`. */
export async function hcDevs($: Engine, lead: string): Promise<OfficeAgent[]> {
  const ls = await $.process.run(['hc', 'ls', '--all', '--json', '--label', `factory.lead=${lead}`])
  if (ls.exitCode !== 0) return []
  const terminals = (JSON.parse(ls.stdout) as { terminals?: HcTerminal[] }).terminals ?? []
  return Promise.all(
    terminals.map(async t => {
      const got = await $.process.run(['hc', 'get', t.address, '--json'])
      const full: HcTerminal = got.exitCode === 0 ? { ...t, ...(JSON.parse(got.stdout) as HcTerminal) } : t
      const labels = full.labels ?? {}
      return {
        id: t.address,
        team: 'dev' as const,
        role: 'factory:developer',
        task: (labels['factory.task'] ?? '').slice(0, 40),
        status: fromHc(full),
        codename: labels.codename ?? null,
        terminal: t.address,
      }
    }),
  )
}

const SAFE = /[^A-Za-z0-9_-]/g

/** Lead identity and run-file path, or null outside the Herdr app and herdr. */
export async function leadOf($: Engine): Promise<{ lead: OfficeLead; space: string | null; path: string } | null> {
  const home = await $.env.get('HOME')
  const hc = await $.env.get('HC_TERMINAL_ID')
  if (!home) return null
  if (hc) {
    const got = await $.process.run(['hc', 'get', hc, '--json'])
    const labels = got.exitCode === 0 ? ((JSON.parse(got.stdout) as HcTerminal).labels ?? {}) : {}
    return { lead: { terminal: hc, codename: labels.codename ?? null }, space: labels['herdr.space'] ?? null, path: `${home}/.cache/factory/${hc.replace(SAFE, '_')}.json` }
  }
  const session = (await $.env.get('HERDR_ENV')) === '1' ? await $.env.get('HERDR_SESSION') : undefined
  const pane = await $.env.get('HERDR_PANE_ID')
  if (!session || !pane) return null
  return { lead: { terminal: pane, codename: null }, space: null, path: `${home}/.cache/factory/${`${session}-${pane}`.replace(SAFE, '_')}.json` }
}

/** Atomic write: temp file then rename. */
export async function writeAtomic($: Engine, path: string, text: string): Promise<void> {
  const tmp = `${path}.${(await $.clock.now()).toString(36)}.tmp`
  await $.fs.write(tmp, text)
  const mv = await $.process.run(['mv', '-f', tmp, path])
  if (mv.exitCode !== 0) throw new Error(`factory: cannot write ${path}: ${mv.stderr.trim()}`)
}
