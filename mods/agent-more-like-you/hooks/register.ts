import type { Engine, Register } from 'claude-code'
import { audienceOf, profileSection, type Audience } from './audience'
import { readConfig, resolveFolder } from './config'
import { observe } from './extractors'
import { feedbackEntry, rulesSection } from './feedback'
import { label, queue, runEval, samples } from './ingest'
import { localLearn, modeOf, shouldSpawn, spawnRefresh } from './learn'
import { cleanPrompt, pastedSpans, redact, writeText } from './transcripts'

const TOOL = 'more_like_you'
const DAY = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 800
const PERSPECTIVE_MAX = 800
const PERSPECTIVE_HEAD = 'How the user thinks and why. Use it to understand their reasoning and explain trade-offs in terms they care about. It is not evidence that they are right: judge each case on its merits, disagree when the facts point elsewhere, and do not agree just because something matches their past choices.'
const PRECEDENCE =
  "Precedence: the user's CLAUDE.md, rules files, hooks and org rules first, then stop-slop bans, then the user's explicit instructions below, then the learnt profile. Formatting rules from those sources (layout, bullets, line breaks, length) override the learnt profile; never merge lines or collapse a list into one line to match it."

type Row = Record<string, unknown>
type Identity = { slackId?: string; ghLogin?: string; accountId?: string }

async function fetchVaultPath($: Engine, url: string): Promise<string | null> {
  const res = await Promise.race([$.http.fetch(url), $.clock.sleep(FETCH_TIMEOUT_MS).then(() => null)])
  if (!res?.ok) return null
  const path = (JSON.parse(res.text) as { settings?: { vaultPath?: unknown } }).settings?.vaultPath
  return typeof path === 'string' && path ? path : null
}

async function readText($: Engine, path: string): Promise<string | null> {
  return (await $.fs.exists(path)) ? $.fs.read(path) : null
}

async function readJson($: Engine, path: string): Promise<any> {
  try {
    return JSON.parse((await readText($, path)) ?? 'null')
  } catch {
    return null
  }
}

async function append($: Engine, path: string, rows: Row[]): Promise<void> {
  if (rows.length) await $.fs.write(path, `${(await readText($, path)) ?? ''}${rows.map((r) => `${JSON.stringify(r)}\n`).join('')}`)
}

async function promptsSince($: Engine, folder: string, since: number): Promise<number> {
  const names = (await $.fs.list(`${folder}/raw`)).map((f) => f.name).filter((n) => n.endsWith('-prompts.jsonl'))
  let count = 0
  for (const name of names) {
    for (const line of (await $.fs.read(`${folder}/raw/${name}`)).split('\n')) {
      const row = line.startsWith('{') ? (JSON.parse(line) as Row) : null
      if (row?.source === 'prompts' && Date.parse(String(row.ts)) > since) count++
    }
  }
  return count
}

interface Place { folder: string; vaultRoot: string | null; home: string; env: Record<string, string | undefined> }
interface State {
  gated: Set<string>
  drafts: Map<string, { audience: Audience; text: string }>
  place?: Promise<Place>
  identity?: Identity
  usageUnknown: boolean
  nudgedFor?: string
}

function where($: Engine, s: State): Promise<Place> {
  return (s.place ??= (async () => {
    const env: Record<string, string | undefined> = {
      HOME: await $.env.get('HOME'),
      MORE_LIKE_YOU_VAULT: await $.env.get('MORE_LIKE_YOU_VAULT'),
      VAULT_PATH: await $.env.get('VAULT_PATH'),
      AGENT_MONITOR_URL: await $.env.get('AGENT_MONITOR_URL'),
      MORE_LIKE_YOU_CHILD: await $.env.get('MORE_LIKE_YOU_CHILD'),
    }
    const home = env.HOME ?? ''
    return { ...(await resolveFolder((k) => env[k], home, (url) => fetchVaultPath($, url))), home, env }
  })())
}

async function configOf($: Engine, folder: string) {
  return readConfig(await readText($, `${folder}/config.json`))
}

async function rawFile($: Engine, folder: string, kind: string): Promise<string> {
  return `${folder}/raw/${new Date(await $.clock.now()).toISOString().slice(0, 10)}-${kind}.jsonl`
}

async function startLearning($: Engine, s: State, interactive: boolean): Promise<void> {
  const { folder, vaultRoot, env } = await where($, s)
  if (interactive && env.MORE_LIKE_YOU_CHILD !== '1') localLearn($, folder, vaultRoot).catch(() => {})
}

async function maybeRefresh($: Engine, s: State, mode: string): Promise<void> {
  const { folder, home, env } = await where($, s)
  const cfg = await configOf($, folder)
  if (cfg.autoRefresh !== 'full') return
  const verdict = shouldSpawn(
    cfg,
    await readJson($, `${folder}/cursor.json`),
    await readJson($, `${home}/.claude/usage-state.json`),
    (k) => env[k],
    await readJson($, `${folder}/.refresh.lock`),
    await $.clock.now(),
    mode,
  )
  if (verdict.spawn) await spawnRefresh($, folder, mode)
  else s.usageUnknown = verdict.reason === 'usage-missing' || verdict.reason === 'usage-stale'
}

async function gate($: Engine, s: State, e: any, next: any, audience: Audience, folder: string, child: boolean) {
  if (!(await configOf($, folder)).audiences[audience]) return next(e)
  const sid = await $.session.id()
  if (s.gated.has(`${sid}:${audience}`)) {
    const text = writeText(e.tool, e)
    if (text) s.drafts.set(sid, { audience, text })
    return next(e)
  }
  if (child) return next(e)
  const rules = rulesSection((await readText($, `${folder}/rules.md`)) ?? '', audience)
  const profile = profileSection((await readText($, `${folder}/style-profile.md`)) ?? '', audience)
  if (!rules && !profile) return next(e)
  s.gated.add(`${sid}:${audience}`)
  const reply = 'Redraft in this voice and call the tool again; do not quote this guidance.'
  return { deny: [PRECEDENCE, rules, profile, reply].filter(Boolean).join('\n\n') }
}

async function observeResult($: Engine, s: State, e: any, r: any, folder: string): Promise<void> {
  s.identity ??= (await readJson($, `${folder}/cursor.json`))?.identity
  if (!s.identity || r.result === undefined) return
  const text = typeof r.result === 'string' ? r.result : JSON.stringify(r.result)
  await append($, await rawFile($, folder, 'observed'), observe(e.tool, e, text, s.identity) as Row[])
}

async function capture($: Engine, s: State, e: any, folder: string): Promise<void> {
  const now = await $.clock.now()
  const ts = new Date(now).toISOString()
  const sid = await $.session.id()
  const cleaned = cleanPrompt(e.text)
  const text = cleaned && redact(cleaned)
  if ((await configOf($, folder)).sources.prompts) {
    const rows: Row[] = text ? [{ id: `prompts:${sid}:${now}`, source: 'prompts', ts, text }] : []
    pastedSpans(e.text).forEach((p, i) => rows.push({ id: `pasted:${sid}:${now}:${i}`, source: 'pasted', author: 'unknown', ts, text: redact(p) }))
    await append($, await rawFile($, folder, 'prompts'), rows)
  }
  const draft = s.drafts.get(sid)
  const instruction = draft && cleanPrompt(e.text, 1)
  if (draft && instruction) {
    s.drafts.delete(sid)
    await append($, await rawFile($, folder, 'feedback'), [feedbackEntry(redact(instruction), draft, ts) as unknown as Row])
  }
}

async function perspective($: Engine, folder: string): Promise<string> {
  if (!(await configOf($, folder)).perspective) return ''
  const text = await readText($, `${folder}/perspective.md`)
  if (!text?.trim()) return ''
  let body = ''
  for (const l of text.trim().split('\n')) {
    if (body.length + l.length + 1 > PERSPECTIVE_MAX) break
    body += `${l}\n`
  }
  return body.trim() ? `${PERSPECTIVE_HEAD}\n${body.trimEnd()}` : ''
}

async function nudge($: Engine, s: State, folder: string): Promise<string> {
  const cursor = await readJson($, `${folder}/cursor.json`)
  if (!cursor) return 'No style profile yet: suggest the user run `/more-like-you learn`.'
  const { staleDays } = await configOf($, folder)
  const updated = Date.parse(cursor.updatedAt)
  if (!s.usageUnknown && updated && (await $.clock.now()) - updated <= staleDays * DAY) return ''
  const captured = await promptsSince($, folder, updated || 0)
  return `Style profile is stale (${captured} prompts captured since the last update): suggest the user run \`/more-like-you refresh\`.`
}

export const register: Register = (on) => {
  const s: State = { gated: new Set(), drafts: new Map(), usageUnknown: false }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.tool.register({
      name: TOOL,
      description:
        "Learn the user's writing voice. Actions: ingest (classify new pulled text), eval (score the classifier on a labelled file), queue (paragraphs needing an LLM judgement), label (store judgements), samples (human paragraphs for an audience). Writes only new files in the style folder.",
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['ingest', 'eval', 'queue', 'label', 'samples'] },
          file: { type: 'string', description: 'Labelled JSONL path, for eval and queue.' },
          limit: { type: 'number', description: 'Max paragraphs, for queue.' },
          full: { type: 'boolean', description: 'For ingest: relearn markers over everything.' },
          labels: {
            type: 'array',
            description: 'For label.',
            items: {
              type: 'object',
              properties: { pid: { type: 'string' }, label: { type: 'string', enum: ['human', 'ai', 'unsure'] }, reason: { type: 'string' } },
              required: ['pid', 'label'],
            },
          },
          audience: { type: 'string', description: 'For samples.' },
        },
        required: ['action'],
      },
      isDeferred: false,
    })
    await startLearning($, s, (e as unknown as { isInteractive?: boolean }).isInteractive === true).catch(() => {})
    return started
  }).catch(($, e, next) => next(e))

  on('classic.SessionStart', async ($, e, next) => {
    await maybeRefresh($, s, modeOf(e.permission_mode)).catch(() => {})
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: `mcp__agent-more-like-you__${TOOL}` }, async ($, e) => {
    const { action, file, limit, labels, audience, full } = e as unknown as {
      action: string
      full?: boolean
      file?: string
      limit?: number
      labels?: { pid: string; label: string; reason: string }[]
      audience?: Audience
    }
    const { folder, vaultRoot, home } = await where($, s)
    const { judgeLimit } = await configOf($, folder)
    if (action === 'ingest') {
      const out = await localLearn($, folder, vaultRoot, full === true)
      return { result: out === 'locked' ? 'learn already running' : out }
    }
    if (action === 'eval' && file) return { result: await runEval($, folder, file) }
    if (action === 'queue') return { result: await queue($, folder, Math.min(limit ?? judgeLimit, judgeLimit), file) }
    if (action === 'label' && labels) return { result: await label($, folder, labels as never) }
    if (action === 'samples' && audience) return { result: await samples($, folder, audience) }
    return { deny: 'action must be ingest, eval (file), queue, label (labels) or samples (audience)' }
  })

  on('tool.call', async ($, e, next) => {
    const audience = audienceOf(e.tool, e as unknown as Row)
    const { folder, env } = await where($, s)
    if (audience) return gate($, s, e, next, audience, folder, env.MORE_LIKE_YOU_CHILD === '1')
    const r = await next(e)
    await observeResult($, s, e, r, folder).catch(() => {})
    return r
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    const context: string[] = []
    try {
      const { folder } = await where($, s)
      if ((e as unknown as { origin?: { kind: string } }).origin?.kind === 'composer') await capture($, s, e, folder)
      const id = await $.session.id()
      if (id !== s.nudgedFor) {
        s.nudgedFor = id
        const line = await nudge($, s, folder)
        if (line) context.push(`# Personal style (agent-more-like-you)\n${line}`)
        const view = await perspective($, folder)
        if (view) context.push(view)
      }
    } catch {}
    return next(context.length ? { ...e, context: [...(e.context ?? []), ...context] } : e)
  }).catch(($, e, next) => next(e))
}
