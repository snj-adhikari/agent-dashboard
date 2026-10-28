importScripts('cookies.js', 'scope.js', 'blocked.js')

let claudeIds = new Set()
let sites = []
let writing = Promise.resolve()

/** Writes are chained so a burst of matches doesn't drop entries. */
function record({ request, rule }) {
  const entry = { ...describe(request.url, { type: request.type, redirect: rule.ruleId === 100 }), time: Date.now(), tabId: request.tabId, url: request.url }
  writing = writing.then(async () => {
    const { log = [] } = await chrome.storage.session.get('log')
    const next = [entry, ...log].slice(0, LOG_MAX)
    await chrome.storage.session.set({ log: next })
    const count = next.filter((e) => e.tabId === request.tabId).length
    if (request.tabId >= 0) chrome.action.setBadgeText({ tabId: request.tabId, text: String(count) }).catch(() => {})
  }).catch(() => {})
}

async function seed() {
  if ((await chrome.storage.sync.get('sites')).sites) return
  const config = await (await fetch(chrome.runtime.getURL('config.json'))).json()
  await chrome.storage.sync.set({ sites: config.sites || [] })
}

async function sync() {
  sites = (await chrome.storage.sync.get('sites')).sites || []
  const groups = (await chrome.tabGroups.query({})).filter((g) => CLAUDE_GROUP.test(g.title || ''))
  const tabs = (await Promise.all(groups.map((g) => chrome.tabs.query({ groupId: g.id })))).flat()
  claudeIds = new Set(tabs.map((t) => t.id))
  const base = await (await fetch(chrome.runtime.getURL('rules.json'))).json()
  const old = await chrome.declarativeNetRequest.getSessionRules()
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: old.map((r) => r.id),
    addRules: claudeIds.size && sites.length ? buildRules(base, [...claudeIds], sites) : []
  })
}

function purge(cookie) {
  if (!claudeIds.size || !isTracking(cookie, sites)) return
  const url = `http${cookie.secure ? 's' : ''}://${cookie.domain.replace(/^\./, '')}${cookie.path}`
  chrome.cookies.remove({ url, name: cookie.name, storeId: cookie.storeId })
}

const purgeAll = () => Promise.all(sites.map((domain) => chrome.cookies.getAll({ domain }))).then((cs) => cs.flat().forEach(purge))

const siteUrl = (url) => /^https?:/.test(url) && onSite(new URL(url).hostname, sites)

chrome.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  await sync()
  if (change.status !== 'loading' || !claudeIds.has(tabId) || !siteUrl(tab.url || '')) return
  chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['hide-cookies.js'], world: 'MAIN', injectImmediately: true })
})
chrome.tabs.onCreated.addListener(sync)
chrome.tabs.onRemoved.addListener(sync)
chrome.tabGroups.onUpdated.addListener(sync)
chrome.tabGroups.onRemoved.addListener(sync)
chrome.cookies.onChanged.addListener(({ removed, cookie }) => {
  if (!removed) purge(cookie)
})
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.sites) sync().then(purgeAll)
})
chrome.runtime.onInstalled.addListener(({ reason }) => {
  seed().then(sync).then(purgeAll)
  if (reason === 'install') chrome.runtime.openOptionsPage()
})
chrome.runtime.onStartup.addListener(() => seed().then(sync).then(purgeAll))
chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener(record)
chrome.action.setBadgeBackgroundColor({ color: '#7c3aed' })
