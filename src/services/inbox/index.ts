import { execFile } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { classify, type Notification, type Verdict } from './filter'
import { inboxWatch, setInboxWatch } from './health'
import { drainTick, queuePoll } from '../hooks'
import { enqueue, seenPr } from '../hooks/state'
import { loadConfig } from '../hooks/config'
import { prReviewEvent, slackPrReviewHook } from '../hooks/slackPrReviewHook'
import { jiraMentionPrHook } from '../hooks/jiraMentionPrHook'
import { skipPendingReviews } from '../hooks/reviewGuard'
import { log, logError } from '../hooks/logger'
import { notify } from '../push'
import type { Trigger } from '../hooks/types'

const execFileAsync = promisify(execFile)
const DB_PATH = path.join(os.homedir(), 'Library', 'Group Containers', 'group.com.apple.usernoted', 'db2', 'db')
const WATCH_MS = 15_000
const POLL_DEBOUNCE_MS = 60_000
const MAX_ITEMS = 100
const MAX_FIELD = 4000

export interface InboxItem {
  at: string
  source: string
  title: string
  verdict: Verdict
  reasons: string[]
  urls: string[]
  action: string
}

// ponytail: in memory, lost on restart; persist alongside hooks-state.json if history matters
let items: InboxItem[] = []
const lastPoll = new Map<string, number>()

export function inboxItems(): InboxItem[] {
  return items
}

function record(item: InboxItem): InboxItem {
  items = [item, ...items].slice(0, MAX_ITEMS)
  return item
}

function pollSoon(hook: Trigger): string {
  const now = Date.now()
  if (now - (lastPoll.get(hook.name) ?? 0) < POLL_DEBOUNCE_MS) return `${hook.name} poll debounced`
  lastPoll.set(hook.name, now)
  queuePoll(hook).then(drainTick)
  return `${hook.name} poll started`
}

async function queueSlackReview(url: string): Promise<string> {
  if (seenPr(url)) return 'duplicate'
  const event = prReviewEvent(url)
  if (!event) return 'org not allowed'
  const [kept] = await skipPendingReviews(slackPrReviewHook.name, [event])
  if (!kept) return 'pending review already exists'
  enqueue(slackPrReviewHook.name, kept)
  drainTick()
  return 'queued'
}

async function route(n: Notification, verdict: Verdict, reasons: string[], urls: string[], jira: boolean): Promise<string> {
  if (verdict === 'risky' || verdict === 'heavy') {
    notify({ title: `Inbox: ${verdict} request held`, body: `${n.title}: ${reasons.join('; ')}`.slice(0, 300), tag: 'inbox' }).catch(() => undefined)
    return 'held, push sent'
  }
  if (process.env.DISABLE_HOOKS && verdict !== 'other') return 'hooks disabled, not run'
  if (verdict === 'pr-review' && jira) return urls.every(seenPr) ? 'duplicate' : pollSoon(jiraMentionPrHook)
  if (verdict === 'pr-review') return (await Promise.all(urls.map(queueSlackReview))).join(', ')
  if (verdict === 'pr-review-check') return pollSoon(jira ? jiraMentionPrHook : slackPrReviewHook)
  return 'ignored'
}

const clip = (v: unknown): string => String(v ?? '').slice(0, MAX_FIELD)

/** One path for every notification: the watcher and POST /api/inbox. */
export async function ingest(raw: Notification): Promise<InboxItem> {
  const n = { source: clip(raw.source) || 'unknown', title: clip(raw.title), subtitle: clip(raw.subtitle), body: clip(raw.body) }
  const { verdict, reasons, urls, jira } = classify(n, loadConfig().allowedGithubOrgs)
  let action: string
  try {
    action = await route(n, verdict, reasons, urls, jira)
  } catch (e) {
    action = `failed: ${(e as Error).message}`.slice(0, 200)
    logError(`inbox: ${action}`)
  }
  if (verdict !== 'other') log(`inbox: ${verdict} from ${n.source} "${n.title}" -> ${action}`)
  return record({ at: new Date().toISOString(), source: n.source, title: n.title || n.subtitle, verdict, reasons, urls, action })
}

async function sqlite(sql: string): Promise<Record<string, unknown>[]> {
  const { stdout } = await execFileAsync('sqlite3', ['-readonly', '-json', DB_PATH, sql], { encoding: 'utf8', timeout: 10_000, maxBuffer: 20_000_000 })
  return stdout.trim() ? JSON.parse(stdout) : []
}

async function plistField(file: string, key: string): Promise<string> {
  try {
    return (await execFileAsync('plutil', ['-extract', key, 'raw', '-o', '-', file], { encoding: 'utf8', timeout: 5000 })).stdout.trim()
  } catch {
    return ''
  }
}

async function decode(hex: string): Promise<Notification> {
  const file = path.join(os.tmpdir(), `agent-monitor-inbox-${process.pid}-${Date.now()}.plist`)
  fs.writeFileSync(file, Buffer.from(hex, 'hex'), { mode: 0o600 })
  try {
    const [title, subtitle, body] = await Promise.all(['req.titl', 'req.subt', 'req.body'].map((k) => plistField(file, k)))
    return { source: 'slack', title, subtitle, body }
  } finally {
    fs.rmSync(file, { force: true })
  }
}

let lastRecId: number | null = null

async function watchTick(): Promise<void> {
  try {
    if (lastRecId === null) {
      const [row] = await sqlite('SELECT COALESCE(MAX(rec_id), 0) AS max FROM record')
      lastRecId = Number(row?.max) || 0
    } else {
      const rows = await sqlite(
        `SELECT r.rec_id AS id, hex(r.data) AS data FROM record r JOIN app a ON a.app_id = r.app_id WHERE a.identifier LIKE 'com.tinyspeck.slackmacgap%' AND r.rec_id > ${lastRecId} ORDER BY r.rec_id`
      )
      for (const row of rows) {
        lastRecId = Math.max(lastRecId, Number(row.id))
        await ingest(await decode(String(row.data)))
      }
    }
    if (!inboxWatch().ok) log('inbox watcher: reading Slack notifications')
    setInboxWatch({ ok: true, error: null })
  } catch (e) {
    const msg = String((e as { stderr?: string }).stderr || (e as Error).message)
    const error = /authorization denied|unable to open|not permitted/i.test(msg) ? `inbox watcher needs Full Disk Access for ${process.execPath}` : `inbox watcher: ${msg.trim().slice(0, 200)}`
    if (inboxWatch().error !== error) logError(error)
    setInboxWatch({ ok: false, error })
  }
}

/** Reads new Slack notifications every 15 s; the first read only records where history ends. */
export function startInboxWatch(): void {
  if (process.env.INBOX_WATCH === '0') return setInboxWatch({ ok: false, error: 'off (INBOX_WATCH=0)' })
  let busy = false
  const tick = async () => {
    if (busy) return
    busy = true
    await watchTick().finally(() => (busy = false))
  }
  tick()
  setInterval(tick, WATCH_MS)
}
