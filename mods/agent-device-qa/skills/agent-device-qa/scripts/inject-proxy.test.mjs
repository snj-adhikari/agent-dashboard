import { test, before, after } from 'node:test'
import assert from 'node:assert'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { startProxy } from './inject-proxy.mjs'

const html = '<html><body><p>hi</p></body></html>'
const json = '{"a":1,"b":"</body>"}\n'
let upstream, proxy, base, out

before(async () => {
  upstream = http.createServer((req, res) => {
    if (req.url === '/') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html)
    res.writeHead(200, { 'content-type': 'application/json' }).end(json)
  }).listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'adq-test-'))
  proxy = startProxy({ listen: 0, target: upstream.address().port, out })
  await once(proxy, 'listening')
  base = `http://127.0.0.1:${proxy.address().port}`
})

after(() => {
  proxy.close()
  upstream.close()
  fs.rmSync(out, { recursive: true, force: true })
})

test('injects the script before </body> in HTML', async () => {
  const body = await (await fetch(base + '/')).text()
  assert.match(body, /<p>hi<\/p><script>addEventListener\('load'[\s\S]*<\/script><\/body><\/html>$/)
  assert.ok(body.includes('__dlWrapped'))
})

test('passes non-HTML through byte-identical', async () => {
  const buf = Buffer.from(await (await fetch(base + '/data.json')).arrayBuffer())
  assert.deepStrictEqual(buf, Buffer.from(json))
})

test('POST /__dl appends a line to results.jsonl', async () => {
  const res = await fetch(base + '/__dl', { method: 'POST', body: JSON.stringify({ tag: 'x', ev: ['a'] }) })
  assert.strictEqual(await res.text(), 'ok')
  const lines = fs.readFileSync(path.join(out, 'results.jsonl'), 'utf8').trim().split('\n')
  assert.deepStrictEqual(JSON.parse(lines.at(-1)), { tag: 'x', ev: ['a'] })
})
