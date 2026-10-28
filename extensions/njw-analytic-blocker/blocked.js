const LOG_MAX = 300
const CLICK_IDS = ['gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'gad_source', 'gad_campaignid', 'fbclid', 'msclkid', '_gl']
const ANALYTICS = ['google-analytics.com', 'analytics.google.com']
const TAGS = ['googletagmanager.com', 'googletagservices.com']
const ADS = ['doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adservice.google.com', 'adservice.google.com.au']
const INSIDER = ['useinsider.com', 'insiderone.com']

const inList = (host, list) => list.some((d) => host === d || host.endsWith(`.${d}`))

/** GA4 puts the event in `en`; Universal Analytics uses hit type `t` plus category/action. */
function analyticsEvent(q) {
  if (q.get('en')) return q.get('en')
  if (q.get('t') === 'event') return [q.get('ec'), q.get('ea'), q.get('el')].filter(Boolean).join(' / ') || 'event'
  if (q.get('t')) return q.get('t')
  return q.get('tid') ? 'events in request body' : ''
}

/** Turns a declarativeNetRequest match into one log entry; `redirect` is true for the click-id strip rule. */
function describe(url, { type = '', redirect = false } = {}) {
  let u
  try {
    u = new URL(url)
  } catch {
    return { kind: 'Request', detail: '', host: '', path: url, type }
  }
  const q = u.searchParams
  const host = u.hostname
  const base = { host, path: u.pathname, type }
  if (redirect) return { ...base, kind: 'Click ids stripped', detail: CLICK_IDS.filter((p) => q.has(p)).join(', ') }
  if (inList(host, ANALYTICS)) return { ...base, kind: 'Analytics event', detail: analyticsEvent(q), id: q.get('tid') || '' }
  if (inList(host, TAGS)) return { ...base, kind: 'Tag manager', detail: q.get('id') || '', id: q.get('id') || '' }
  if (inList(host, ADS)) return { ...base, kind: 'Ad request', detail: '' }
  if (inList(host, INSIDER)) return { ...base, kind: 'Insider', detail: '' }
  return { ...base, kind: 'Third-party request', detail: '' }
}

if (typeof module !== 'undefined') module.exports = { describe, LOG_MAX }
