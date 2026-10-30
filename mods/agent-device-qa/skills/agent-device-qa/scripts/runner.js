(async () => {
  let tag = null
  const notes = []
  const report = (extra) => {
    try {
      return fetch('/__dl', {
        method: 'POST',
        body: JSON.stringify({
          tag,
          ua: navigator.userAgent,
          w: innerWidth,
          href: location.href,
          ev: (window.__dl || []).map((e) => e.ev + (e.body ? ' ' + e.body : '')),
          note: notes.join('; ') || undefined,
          ...extra,
        }),
      }).catch(() => {})
    } catch (e) {}
  }
  try {
    const q = new URLSearchParams(location.hash.slice(1))
    tag = q.get('t')
    if (!tag) return
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    const byText = (pattern) => {
      const re = new RegExp(pattern, 'i')
      return [...document.querySelectorAll('button,a,[role=button]')].filter((el) => visible(el) && re.test(el.innerText || el.textContent || ''))
    }
    const label = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)
    const press = (el, times = 1) => { el.scrollIntoView({ block: 'center' }); for (let i = 0; i < times; i++) el.click() }

    await sleep(Number(q.get('wait') || 1000))
    if (q.get('open')) {
      const el = byText(q.get('open'))[0]
      el ? press(el) : notes.push('open: no match')
      await sleep(2000)
    }
    let seen = []
    if (q.get('sel')) {
      const el = document.querySelector(q.get('sel'))
      if (el && visible(el)) { seen.push(label(el)); press(el, Number(q.get('n') || 1)) } else notes.push('sel: no visible match')
      await sleep(2000)
    }
    if (q.get('click')) {
      const els = byText(q.get('click'))
      seen = seen.concat(els.map(label))
      els[0] ? press(els[0], Number(q.get('n') || 1)) : notes.push('click: no match')
      await sleep(2000)
    }
    if (q.get('again')) {
      const el = byText(q.get('again'))[0]
      el ? press(el) : notes.push('again: no match')
      await sleep(2000)
    }
    const tels = [...document.querySelectorAll('a[href^="tel:"]')].filter(visible)
    if (q.get('tel') === '1') {
      if (tels[0]) {
        tels[0].addEventListener('click', (e) => e.preventDefault(), { once: true })
        tels[0].click()
        await sleep(1500)
      } else notes.push('tel: no visible link')
    }
    const safe = (k, v) => (v && typeof v === 'object' && v.nodeType ? '[node]' : typeof v === 'function' ? '[fn]' : v)
    const raw = q.get('raw')
      ? (window.dataLayer || []).slice(-Number(q.get('raw'))).map((e) => { try { return JSON.stringify(e, safe).slice(0, 1000) } catch (x) { return 'unserialisable' } })
      : undefined
    await report({ seen, tel: tels.length, raw })
  } catch (e) {
    notes.push('runner error: ' + (e && e.message))
    if (tag) await report({})
  }
})()
