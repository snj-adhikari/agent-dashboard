(() => {
  try {
    const dl = (window.dataLayer = window.dataLayer || [])
    if (dl.__dlWrapped) return 'already wrapped, ' + (window.__dl || []).length + ' events'
    window.__dl = window.__dl || []
    const keep = window.__dlKeep ? new RegExp(window.__dlKeep) : null
    const style = document.createElement('style')
    style.textContent = 'nextjs-portal{display:none!important}'
    document.head.appendChild(style)
    let box = null
    if (window.__dlPanel !== false) {
      box = document.createElement('div')
      box.id = '__dlpanel'
      box.style.cssText = 'position:fixed;left:8px;right:8px;top:8px;z-index:2147483647;max-height:40vh;overflow:auto;background:rgba(10,16,28,.92);color:#d7e3ff;font:11px/1.45 Menlo,monospace;padding:8px 10px;border-radius:8px;pointer-events:none;white-space:pre-wrap;word-break:break-all'
      box.textContent = 'dataLayer logger\n'
      document.body.appendChild(box)
    }
    const summary = (a) => {
      const parts = []
      for (const k of Object.keys(a)) {
        const v = a[k]
        if (k === 'event' || typeof v === 'function' || (v && typeof v === 'object')) continue
        parts.push(k + '=' + String(v))
      }
      return parts.join(' ').slice(0, 300)
    }
    const record = (a) => {
      if (!a || typeof a !== 'object' || a.nodeType) return
      const ev = typeof a.event === 'string' ? a.event : '(no event)'
      if (keep && !keep.test(ev)) return
      const t = new Date().toISOString().slice(11, 23)
      const body = summary(a)
      window.__dl.push({ t, ev, body })
      if (box) box.appendChild(document.createTextNode(t + ' ' + ev + (body ? ' ' + body : '') + '\n'))
    }
    const orig = dl.push
    dl.push = function (...args) {
      try { args.forEach(record) } catch (e) {}
      return orig.apply(dl, args)
    }
    dl.__dlWrapped = true
    return 'ok w=' + innerWidth
  } catch (e) {
    return 'logger error: ' + (e && e.message)
  }
})()
