const list = document.getElementById('sites')
const origins = (site) => ({ origins: [`*://*.${site}/*`] })
const getSites = async () => (await chrome.storage.sync.get('sites')).sites || []
const setSites = (sites) => chrome.storage.sync.set({ sites })

function toSite(input) {
  const raw = input.trim().toLowerCase()
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.replace(/^\*\./, '')
  } catch {
    return ''
  }
}

function button(text, onClick) {
  const b = document.createElement('button')
  b.textContent = text
  b.onclick = onClick
  return b
}

async function render() {
  const items = []
  for (const site of await getSites()) {
    const li = document.createElement('li')
    const name = document.createElement('span')
    name.textContent = site
    li.append(name)
    if (await chrome.permissions.contains(origins(site))) {
      const ok = document.createElement('small')
      ok.textContent = 'access granted'
      li.append(ok)
    } else {
      li.append(button('Grant access', () => chrome.permissions.request(origins(site)).then(render)))
    }
    li.append(
      button('Remove', async () => {
        await chrome.permissions.remove(origins(site))
        await setSites((await getSites()).filter((s) => s !== site))
      })
    )
    items.push(li)
  }
  list.replaceChildren(...items)
}

document.getElementById('add').onsubmit = async (e) => {
  e.preventDefault()
  const input = document.getElementById('site')
  const site = toSite(input.value)
  if (!site) return
  const granted = chrome.permissions.request(origins(site))
  const sites = await getSites()
  if (!sites.includes(site)) await setSites([...sites, site])
  input.value = ''
  await granted.catch(() => false)
  render()
}

document.getElementById('title').textContent = chrome.runtime.getManifest().name
chrome.storage.onChanged.addListener((changes) => changes.sites && render())
render()
