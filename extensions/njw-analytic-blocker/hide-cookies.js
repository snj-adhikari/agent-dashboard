Object.defineProperty(Document.prototype, 'cookie', { get: () => '', set: () => {}, configurable: true })
if (window.CookieStore) {
  const proto = CookieStore.prototype
  proto.get = () => Promise.resolve(null)
  proto.getAll = () => Promise.resolve([])
  proto.set = () => Promise.resolve()
  proto.delete = () => Promise.resolve()
}
