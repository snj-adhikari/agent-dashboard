import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const here = path.dirname(fileURLToPath(import.meta.url))

export function startProxy({ listen = 3005, target = 3000, out = path.join(os.tmpdir(), 'agent-device-qa'), delay = 3000 } = {}) {
  const code = ['logger.js', 'runner.js'].map((f) => fs.readFileSync(path.join(here, f), 'utf8')).join(';\n')
  const tag = `<script>addEventListener('load',()=>setTimeout(()=>{try{${code}}catch(e){}},${Number(delay)}))</script>`
  fs.mkdirSync(out, { recursive: true })
  const results = path.join(out, 'results.jsonl')

  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/__dl') {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        fs.appendFileSync(results, Buffer.concat(chunks).toString('utf8').replace(/\n/g, ' ') + '\n')
        res.end('ok')
      })
      return
    }
    const headers = { ...req.headers, host: `localhost:${target}`, 'accept-encoding': 'identity' }
    const up = http.request({ host: '127.0.0.1', port: target, path: req.url, method: req.method, headers }, (r) => {
      const h = { ...r.headers }
      if (h.location) h.location = h.location.replace(`:${target}`, `:${server.address().port}`)
      if (!String(h['content-type'] || '').includes('text/html')) {
        res.writeHead(r.statusCode, h)
        r.pipe(res)
        return
      }
      const chunks = []
      r.on('data', (c) => chunks.push(c))
      r.on('end', () => {
        let body = Buffer.concat(chunks).toString('utf8')
        const i = body.lastIndexOf('</body>')
        if (i !== -1) body = body.slice(0, i) + tag + body.slice(i)
        delete h['content-length']
        delete h['content-encoding']
        res.writeHead(r.statusCode, h)
        res.end(body)
      })
    })
    up.on('error', () => {
      if (!res.headersSent) res.writeHead(502)
      res.end('upstream error')
    })
    req.pipe(up)
  })
  server.listen(Number(listen), '127.0.0.1')
  return server
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const { values } = parseArgs({ options: { listen: { type: 'string' }, target: { type: 'string' }, out: { type: 'string' }, delay: { type: 'string' } } })
  const opts = {
    listen: Number(values.listen ?? process.env.PROXY_PORT ?? 3005),
    target: Number(values.target ?? process.env.APP_PORT ?? 3000),
    out: values.out ?? process.env.OUT ?? path.join(os.tmpdir(), 'agent-device-qa'),
    delay: Number(values.delay ?? 3000),
  }
  startProxy(opts).on('listening', () => console.log(`proxy http://127.0.0.1:${opts.listen} -> 127.0.0.1:${opts.target}, results ${path.join(opts.out, 'results.jsonl')}`))
}
