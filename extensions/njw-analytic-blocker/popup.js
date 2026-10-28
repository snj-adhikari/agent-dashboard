const list = document.getElementById('log')
const summary = document.getElementById('summary')
const scope = document.getElementById('scope')
let tabId = -1

function el(tag, className, text) {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text) e.textContent = text
  return e
}

async function render() {
  const { log = [] } = await chrome.storage.session.get('log')
  const rows = scope.value === 'tab' ? log.filter((e) => e.tabId === tabId) : log
  const counts = rows.reduce((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] || 0) + 1 }), {})
  summary.replaceChildren(
    ...Object.entries(counts).map(([kind, n]) => {
      const chip = el('span', 'chip', `${kind} `)
      chip.append(el('b', '', String(n)))
      return chip
    })
  )
  if (!rows.length) {
    list.replaceChildren(el('li', 'empty', 'Nothing blocked yet. Blocking runs only in Claude tab groups on your sites.'))
    return
  }
  list.replaceChildren(
    ...rows.map((e) => {
      const li = el('li')
      const row = el('div', 'row')
      row.append(el('span', 'kind', e.kind))
      if (e.detail) row.append(el('span', 'detail', e.detail))
      row.append(el('span', 'time', new Date(e.time).toLocaleTimeString()))
      li.append(row, el('div', 'url', `${e.type ? `${e.type} ` : ''}${e.host}${e.path}`))
      li.title = e.url
      return li
    })
  )
}

document.getElementById('title').textContent = chrome.runtime.getManifest().name
document.getElementById('sites').onclick = () => chrome.runtime.openOptionsPage()
document.getElementById('clear').onclick = async () => {
  await chrome.storage.session.set({ log: [] })
  for (const t of await chrome.tabs.query({})) chrome.action.setBadgeText({ tabId: t.id, text: '' })
}
scope.onchange = render
chrome.storage.onChanged.addListener((changes, area) => area === 'session' && changes.log && render())
chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  tabId = tab?.id ?? -1
  render()
})
