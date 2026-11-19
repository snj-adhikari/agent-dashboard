import type { Holding, SideItem, SideSettings } from '../agents'
import { CuckooError } from '../relayLog'
import type { Provider, SideData } from './registry'

const ENDPOINT = 'https://api.coingecko.com/api/v3/simple/price'
const CACHE_MS = 60_000
export const MAX_BODY = 64 * 1024

type Prices = Record<string, number>

export const cryptoDeps = {
  fetch: (url: string): Promise<Response> => fetch(url, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } }),
  now: (): number => Date.now(),
}

export const priceUrl = (symbols: string[], currency: string): string =>
  `${ENDPOINT}?symbols=${encodeURIComponent(symbols.map((s) => s.toLowerCase()).join(','))}&vs_currencies=${encodeURIComponent(currency.toLowerCase())}`

const tooBig = (): never => {
  throw new CuckooError('not_installed', 'price feed response too large')
}

/** Streams the body and stops reading past `MAX_BODY`, so a huge reply is never buffered. */
async function cappedText(res: Response): Promise<string> {
  if (Number(res.headers.get('content-length')) > MAX_BODY) tooBig()
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY) {
      await reader.cancel().catch(() => undefined)
      tooBig()
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

let cache: { key: string; at: number; prices: Prices } | null = null
let keyDenied = false
export const resetCryptoCache = (): void => {
  cache = null
  keyDenied = false
}

/** Keyed by symbols + currency; a 401/403 means the feed now wants a key. */
export async function prices(symbols: string[], currency: string): Promise<Prices> {
  const url = priceUrl([...new Set(symbols)].sort(), currency)
  const now = cryptoDeps.now()
  if (cache && cache.key === url && now - cache.at < CACHE_MS) return cache.prices
  const res = await cryptoDeps.fetch(url).catch(() => {
    throw new CuckooError('host_failed', 'price feed unreachable')
  })
  if (res.status === 401 || res.status === 403) {
    keyDenied = true
    throw new CuckooError('needs_key', 'price feed requires an API key')
  }
  if (!res.ok) throw new CuckooError('host_failed', `price feed returned ${res.status}`)
  keyDenied = false
  let body: Record<string, Record<string, unknown>>
  try {
    body = JSON.parse(await cappedText(res)) as Record<string, Record<string, unknown>>
  } catch (e) {
    if (e instanceof CuckooError) throw e
    throw new CuckooError('host_failed', 'price feed sent bad JSON')
  }
  const cur = currency.toLowerCase()
  const out: Prices = {}
  for (const [sym, row] of Object.entries(body ?? {})) {
    const v = row?.[cur]
    if (typeof v === 'number' && Number.isFinite(v)) out[sym.toUpperCase()] = v
  }
  cache = { key: url, at: now, prices: out }
  return out
}

const money = (n: number, currency: string): string => `${currency} ${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function portfolio(holdings: Holding[], p: Prices, currency: string): SideData {
  let total = 0
  const items: SideItem[] = holdings.map((h) => {
    const price = p[h.symbol]
    const worth = price === undefined ? null : price * h.amount
    if (worth !== null) total += worth
    return { id: h.symbol, title: h.symbol, subtitle: String(h.amount), value: worth === null ? null : money(worth, currency), url: null, tone: worth === null ? 'warn' : null, group: null, actions: [] }
  })
  return { items, summary: `Total ${money(total, currency)}` }
}

export const provider: Provider = {
  id: 'crypto',
  actions: [],
  async status() {
    return keyDenied ? { available: false, via: null, reason: 'needs_key' } : { available: true, via: 'web', reason: null }
  },
  async data(settings: SideSettings) {
    if (!settings.holdings.length) return null
    return portfolio(settings.holdings, await prices(settings.holdings.map((h) => h.symbol), settings.currency), settings.currency)
  },
  async action() {
    return null
  },
}

export const providers = [provider]
