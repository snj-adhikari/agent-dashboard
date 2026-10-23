self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {}
  event.waitUntil(
    self.registration.showNotification(data.title || 'Agent Dashboard', {
      body: data.body || '',
      tag: data.tag,
      icon: '/favicon.svg',
      data: { ref: data.ref || '' }
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const ref = event.notification.data && event.notification.data.ref
  const url = '/m/' + (ref ? '?ref=' + encodeURIComponent(ref) : '')
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((list) => {
      const open = list.find((c) => new URL(c.url).pathname.startsWith('/m'))
      return open ? open.navigate(url).then((c) => c && c.focus()) : self.clients.openWindow(url)
    })
  )
})
