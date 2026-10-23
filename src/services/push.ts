import fs from 'fs'
import path from 'path'
import webpush from 'web-push'
import { tailnetSelf } from './tailnet'

const STATE_PATH = path.join(__dirname, '..', '..', 'push-state.json')
const MAX_SUBSCRIPTIONS = 10
const PUSH_SERVICES = /(^|\.)(googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/

interface Subscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

interface PushState {
  publicKey: string
  privateKey: string
  subscriptions: Subscription[]
}

export interface PushPayload {
  title: string
  body: string
  ref?: string
  tag?: string
}

function write(state: PushState): void {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), { mode: 0o600 })
}

/** VAPID keys are generated once and kept with the subscriptions, so phones stay subscribed across restarts. */
function read(): PushState {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
  } catch {
    const state = { ...webpush.generateVAPIDKeys(), subscriptions: [] }
    write(state)
    return state
  }
}

export function vapidPublicKey(): string {
  return read().publicKey
}

/** Only browser push services, so a stored endpoint can't point the server at internal hosts. */
export function isPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return false
  try {
    const url = new URL(endpoint)
    return url.protocol === 'https:' && !url.port && PUSH_SERVICES.test(url.hostname)
  } catch {
    return false
  }
}

function parseSubscription(body: Record<string, unknown>): Subscription | null {
  const keys = body.keys as Record<string, unknown> | undefined
  const { endpoint } = body
  if (!isPushEndpoint(endpoint)) return null
  if (typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string') return null
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }
}

export function addSubscription(body: Record<string, unknown>): boolean {
  const sub = parseSubscription(body)
  if (!sub) return false
  const state = read()
  write({ ...state, subscriptions: [...state.subscriptions.filter((s) => s.endpoint !== sub.endpoint), sub].slice(-MAX_SUBSCRIPTIONS) })
  return true
}

export function removeSubscription(endpoint: string): void {
  const state = read()
  write({ ...state, subscriptions: state.subscriptions.filter((s) => s.endpoint !== endpoint) })
}

/** Sends to every subscribed device and drops subscriptions the push service reports as gone. */
export async function notify(payload: PushPayload): Promise<number> {
  const state = read()
  if (!state.subscriptions.length) return 0
  const vapidDetails = { subject: `https://${tailnetSelf()?.host || 'localhost'}`, publicKey: state.publicKey, privateKey: state.privateKey }
  const gone: string[] = []
  let sent = 0
  await Promise.all(
    state.subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload), { vapidDetails, TTL: 3600 })
        sent++
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode
        if (code === 404 || code === 410) gone.push(sub.endpoint)
        else console.error(`push failed: ${code ?? (e as Error).message}`)
      }
    })
  )
  gone.forEach(removeSubscription)
  return sent
}
