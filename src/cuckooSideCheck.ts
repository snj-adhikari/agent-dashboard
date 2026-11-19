import assert from 'assert'
import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import { Readable } from 'stream'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-side-'))
process.env.CUCKOO_SIDE_DIR = path.join(tmp, 'cuckoo')
process.env.CUCKOO_TOKEN_PATH = path.join(tmp, 'token')
fs.writeFileSync(process.env.CUCKOO_TOKEN_PATH, 'test-token\n', { mode: 0o600 })

/* eslint-disable @typescript-eslint/no-require-imports */
const { handleCuckoo } = require('./routes/cuckoo') as typeof import('./routes/cuckoo')
const { providerStatus, stub, SIDE_IDS, PERSONAL_IDS } = require('./services/cuckoo/side/registry') as typeof import('./services/cuckoo/side/registry')
const { defaultSettings, readSettings, settingsPath } = require('./services/cuckoo/side/config') as typeof import('./services/cuckoo/side/config')
const { inboxDir, resolveUpload, saveUpload, sweepInbox, INBOX_QUOTA, MAX_UPLOAD, sanitiseName } = require('./services/cuckoo/side/upload') as typeof import('./services/cuckoo/side/upload')
const { chat, chatDeps, runHeadless } = require('./services/cuckoo/chat') as typeof import('./services/cuckoo/chat')
const { CuckooError } = require('./services/cuckoo/relayLog') as typeof import('./services/cuckoo/relayLog')
const { isTrustedRequest } = require('./http') as typeof import('./http')
const SIDE_CHECKS = ['mail', 'notes', 'whatsapp', 'music', 'crypto', 'services', 'recap', 'phone'].map((m) => require(`./services/cuckoo/side/${m}.check`) as { run: () => Promise<void> })

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const mode = (p: string): number => fs.statSync(p).mode & 0o777
const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p
    return 'ok'
  } catch (e) {
    return e instanceof CuckooError ? `${e.code} ${e.status}` : String(e)
  }
}

async function main(): Promise<void> {
  const server = http.createServer((req, res) => void handleCuckoo(req, res, new URL(req.url || '/', 'http://127.0.0.1')))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/cuckoo/`
  const auth = { Authorization: 'Bearer test-token' }
  const call = async (route: string, init: RequestInit = {}): Promise<{ status: number; body: Json }> => {
    const r = await fetch(base + route, { ...init, headers: { ...auth, ...(init.headers as object) } })
    return { status: r.status, body: (await r.json()) as Json }
  }

  for (const route of ['side', 'side/mail', 'recap?week=all']) assert.strictEqual((await fetch(base + route)).status, 401, `${route} needs the token`)
  assert.strictEqual((await fetch(base + 'upload', { method: 'POST', body: 'x' })).status, 401, 'upload needs the token')
  console.log('ok side routes need token')

  const gate = (url: string, headers: Record<string, string>): boolean => isTrustedRequest({ method: 'POST', url, headers: { host: '127.0.0.1:5818', ...headers } } as unknown as http.IncomingMessage, 5818)
  const octet = { 'content-type': 'application/octet-stream' }
  const bearer = { authorization: 'Bearer abc' }
  assert.ok(gate('/api/v1/cuckoo/upload', { ...octet, ...bearer }), 'octet-stream upload with Bearer passes')
  assert.ok(!gate('/api/v1/cuckoo/upload', octet), 'octet-stream upload without Authorization rejected')
  assert.ok(!gate('/api/v1/cuckoo/upload', { ...octet, authorization: 'Basic abc' }), 'non-Bearer Authorization rejected')
  for (const other of ['/api/v1/cuckoo/say', '/api/v1/cuckoo/upload/', '/api/v1/cuckoo/uploads', '/api/terminate', '//evil/api/v1/cuckoo/upload']) assert.ok(!gate(other, { ...octet, ...bearer }), `octet-stream on ${other} rejected`)
  assert.ok(!gate('/api/v1/cuckoo/upload', { ...octet, ...bearer, origin: 'https://evil.example' }), 'foreign Origin rejected for upload')
  assert.ok(!gate('/api/v1/cuckoo/say', { 'content-type': 'application/json', origin: 'https://evil.example' }), 'foreign Origin rejected for JSON')
  assert.ok(!gate('/api/v1/cuckoo/upload', { 'content-type': 'text/plain', ...bearer }), 'other types still rejected')
  assert.ok(gate('/api/v1/cuckoo/say', { 'content-type': 'application/json' }), 'JSON unchanged')
  console.log('ok upload trust gate')

  const listed = await call('side')
  assert.strictEqual(listed.status, 200)
  assert.strictEqual(SIDE_IDS.length, 14)
  assert.deepStrictEqual(listed.body.providers.map((p: Json) => p.id), SIDE_IDS, 'all 14 ids in order')
  for (const p of listed.body.providers) assert.deepStrictEqual(Object.keys(p).sort(), ['available', 'enabled', 'id', 'reason', 'via'], `${p.id} shape`)
  assert.strictEqual(listed.body.settings.currency, 'AUD')
  console.log('ok side providers list')

  for (const id of PERSONAL_IDS) {
    assert.strictEqual(defaultSettings().enabled[id], false, `${id} off by default`)
    const p = listed.body.providers.find((x: Json) => x.id === id)
    assert.deepStrictEqual([p.enabled, p.available, p.reason], [false, false, 'disabled'], `${id} reported disabled`)
  }
  assert.strictEqual((await call('side/mail')).body.error, 'no_permission', 'disabled provider gives no data')
  console.log('ok side personal providers default off')

  const settings = defaultSettings()
  let probed = false
  const boom = { ...stub('crypto'), status: async () => { throw new Error('boom') } }
  const hang = { ...stub('crypto'), status: () => new Promise<never>(() => undefined) }
  const spy = { ...stub('mail'), status: async () => { probed = true; return { available: true, via: 'applescript' as const, reason: null } } }
  assert.deepStrictEqual(await providerStatus(boom, settings), { id: 'crypto', available: false, enabled: true, via: null, reason: 'not_installed' })
  assert.strictEqual((await providerStatus(hang, settings, 50)).reason, 'not_installed', 'hang becomes a reason')
  assert.strictEqual((await providerStatus(spy, settings)).reason, 'disabled')
  assert.strictEqual(probed, false, 'disabled provider never probed')
  assert.strictEqual((await call('side/crypto')).status, 424, 'stub data is not a 500')
  console.log('ok side provider failure is reason')

  const saved = await call('side/settings', { method: 'POST', body: JSON.stringify({ enabled: { mail: true }, currency: 'USD', holdings: [{ symbol: 'btc', amount: 0.5 }] }) })
  assert.deepStrictEqual(saved, { status: 200, body: { ok: true } })
  assert.strictEqual(mode(settingsPath()), 0o600, 'side.json 0600')
  assert.strictEqual(mode(path.dirname(settingsPath())), 0o700, 'cuckoo dir 0700')
  const after = (await call('side')).body
  assert.deepStrictEqual([after.settings.enabled.mail, after.settings.currency, after.settings.holdings], [true, 'USD', [{ symbol: 'BTC', amount: 0.5 }]])
  for (const bad of [{ nope: 1 }, { enabled: { bank: true } }, { currency: 'dollars' }, { holdings: [{ symbol: '../x', amount: 1 }] }, { phonePush: 'yes' }]) {
    assert.strictEqual((await call('side/settings', { method: 'POST', body: JSON.stringify(bad) })).body.error, 'bad_request', JSON.stringify(bad))
  }
  assert.strictEqual((await call('side/action', { method: 'POST', body: JSON.stringify({ id: 'mail', action: 'send' }) })).body.error, 'bad_request', 'action not on the allow-list')
  console.log('ok side settings 0600 and validated')

  const up = await call('upload', { method: 'POST', body: 'hello', headers: { 'X-Cuckoo-Name': '..%2F..%2Fetc%2Fpasswd' } })
  assert.strictEqual(up.status, 200)
  assert.match(up.body.uploadId, /^[0-9a-f]{32}$/)
  assert.deepStrictEqual([up.body.name, up.body.bytes, up.body.mime], ['passwd', 5, 'application/octet-stream'])
  const file = resolveUpload(up.body.uploadId)
  assert.strictEqual(path.dirname(file), inboxDir())
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'hello')
  assert.strictEqual(mode(file), 0o600, 'upload 0600')
  assert.strictEqual(mode(inboxDir()), 0o700, 'inbox 0700')
  const names = ['../../a.png', 'a\\b\\c.pdf', '.hidden', '', 'x\u0000y;$(z).txt', 'a'.repeat(300) + '.png'].map(sanitiseName)
  assert.deepStrictEqual(names.slice(0, 5), ['a.png', 'c.pdf', 'hidden', 'file', 'x_y___z_.txt'])
  assert.ok(names[5].length === 100 && names[5].endsWith('.png'), 'long name capped, extension kept')
  const linkId = 'f'.repeat(32)
  fs.symlinkSync('/etc/hosts', path.join(inboxDir(), `${linkId}-evil`))
  assert.strictEqual(await codeOf(Promise.resolve().then(() => resolveUpload(linkId))), 'bad_request 400', 'symlink in inbox not followed')
  console.log('ok upload writes 0600')

  const chunk = Buffer.alloc(1024 * 1024)
  let pulled = 0
  const big = Readable.from((function* () {
    for (let i = 0; i < 40; i++) {
      pulled++
      yield chunk
    }
  })())
  assert.strictEqual(await codeOf(saveUpload(big, 'big.bin')), 'too_large 413')
  assert.ok(pulled <= 28, `stopped while streaming (pulled ${pulled} MB)`)
  assert.strictEqual(await codeOf(saveUpload(Readable.from([]), 'x', MAX_UPLOAD + 1)), 'too_large 413', 'declared length over the cap refused before reading')
  assert.ok(!fs.readdirSync(inboxDir()).some((f) => f.endsWith('-big.bin')), 'partial upload removed')
  const live = await new Promise<{ status: number; body: Json }>((resolve, reject) => {
    const r = http.request(base + 'upload', { method: 'POST', headers: { ...auth, 'X-Cuckoo-Name': 'huge.bin', 'Content-Length': String(MAX_UPLOAD + 1) } }, (res) => {
      let data = ''
      res.on('data', (d) => (data += d))
      res.on('end', () => resolve({ status: res.statusCode || 0, body: JSON.parse(data) as Json }))
    })
    r.on('error', reject)
    r.flushHeaders()
  })
  assert.deepStrictEqual([live.status, live.body.error], [413, 'too_large'], 'over the cap over HTTP, answered before any body')
  console.log('ok upload too_large')

  const argvLog = path.join(tmp, 'argv.log')
  const stdinLog = path.join(tmp, 'stdin.log')
  const claude = path.join(tmp, 'claude')
  const stagedLog = path.join(tmp, 'staged.log')
  fs.writeFileSync(
    claude,
    `#!/bin/sh\nprintf '%s\\n' "$@" > '${argvLog}'\nprev=''\nfor a in "$@"; do [ "$prev" = --add-dir ] && { ls -A "$a"; stat -f %Lp "$a"; } > '${stagedLog}'; prev="$a"; done\ncat > '${stdinLog}'\necho done\n`,
    { mode: 0o755 }
  )
  chatDeps.clis = async () => [{ cli: 'claude', path: claude, version: '1', signedIn: true, chat: true }]
  const second = await call('upload', { method: 'POST', body: 'second', headers: { 'X-Cuckoo-Name': 'two.txt' } })
  const promptText = 'attachment-prompt-77'
  await chat({ text: promptText, attachments: [up.body.uploadId, second.body.uploadId] })
  const argv = fs.readFileSync(argvLog, 'utf8').split('\n')
  assert.ok(!argv.join(' ').includes(promptText), 'prompt not on argv')
  const stagedDir = argv[argv.indexOf('--add-dir') + 1]
  assert.ok(!argv.join('\n').includes(inboxDir()), 'inbox path never on argv')
  assert.ok(fs.readdirSync(inboxDir()).length > 2, 'inbox holds other files too')
  assert.deepStrictEqual(fs.readFileSync(stagedLog, 'utf8').trim().split('\n'), [...[path.basename(file), `${second.body.uploadId}-two.txt`].sort(), '700'], 'staged dir 0700 holds only the attachments')
  const stdin = fs.readFileSync(stdinLog, 'utf8')
  assert.ok(stdin.startsWith(promptText) && stdin.includes(path.join(stagedDir, path.basename(file))) && !stdin.includes(inboxDir()), 'staged paths on stdin, not inbox paths')
  assert.ok(!fs.existsSync(stagedDir), 'staged dir removed after the child exits')
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'hello', 'upload still in the inbox')
  console.log('ok chat attachments isolated')
  for (const bad of [['/etc/passwd'], ['../x'], [linkId], ['0'.repeat(32)], Array(5).fill(up.body.uploadId), 'abc']) {
    assert.strictEqual(await codeOf(chat({ text: 'x', attachments: bad })), 'bad_request 400', `attachments ${JSON.stringify(bad)}`)
  }
  console.log('ok chat attachments by id only')

  assert.strictEqual(await runHeadless('plan my day', { allowedTools: [] }), 'done')
  const hArgv = fs.readFileSync(argvLog, 'utf8').split('\n')
  assert.strictEqual(hArgv[hArgv.indexOf('--tools') + 1], '', 'no tools when none allowed')
  assert.ok(!hArgv.includes('--allowedTools') && !hArgv.join(' ').includes('plan my day'))
  assert.strictEqual(fs.readFileSync(stdinLog, 'utf8'), 'plan my day')
  await runHeadless('notion', { allowedTools: ['mcp__claude_ai_Notion__search'] })
  const mArgv = fs.readFileSync(argvLog, 'utf8').split('\n')
  assert.deepStrictEqual([mArgv[mArgv.indexOf('--tools') + 1], mArgv[mArgv.indexOf('--allowedTools') + 1]], ['', 'mcp__claude_ai_Notion__search'])
  assert.strictEqual(await codeOf(runHeadless('x', { allowedTools: ['Bash(anything)'] })), 'bad_request 400')
  console.log('ok runHeadless stdin and tools')

  const stale = path.join(inboxDir(), `${'a'.repeat(32)}-old.txt`)
  fs.writeFileSync(stale, 'old', { mode: 0o600 })
  const dayAgo = (Date.now() - 25 * 60 * 60 * 1000) / 1000
  fs.utimesSync(stale, dayAgo, dayAgo)
  assert.strictEqual((await saveUpload(Readable.from([Buffer.from('new')]), 'new.txt')).bytes, 3)
  assert.ok(!fs.existsSync(stale), 'upload older than 24 h deleted on upload')
  assert.ok(fs.existsSync(file), 'recent upload kept')
  fs.writeFileSync(stale, 'old', { mode: 0o600 })
  fs.utimesSync(stale, dayAgo, dayAgo)
  sweepInbox()
  assert.ok(!fs.existsSync(stale), 'startup sweep deletes old uploads')
  const filler = path.join(inboxDir(), `${'b'.repeat(32)}-filler.bin`)
  fs.writeFileSync(filler, '', { mode: 0o600 })
  fs.truncateSync(filler, INBOX_QUOTA + 1)
  assert.strictEqual(await codeOf(saveUpload(Readable.from([Buffer.from('x')]), 'x.txt')), 'too_large 413', 'inbox over 200 MB refuses uploads')
  const full = await call('upload', { method: 'POST', body: 'x', headers: { 'X-Cuckoo-Name': 'x.txt' } })
  assert.deepStrictEqual([full.status, full.body.error], [413, 'too_large'], 'quota over HTTP')
  fs.truncateSync(filler, INBOX_QUOTA - sweepInbox() + fs.statSync(filler).size - 1024)
  assert.strictEqual(await codeOf(saveUpload(Readable.from([Buffer.alloc(4096)]), 'y.bin')), 'too_large 413', 'quota enforced while streaming')
  fs.rmSync(filler)
  assert.strictEqual((await saveUpload(Readable.from([Buffer.from('ok')]), 'z.txt')).bytes, 2, 'uploads resume once under quota')
  console.log('ok upload inbox cleanup')

  const decoy = path.join(tmp, 'decoy.json')
  fs.writeFileSync(decoy, JSON.stringify({ enabled: { mail: true, phone: true } }))
  fs.rmSync(settingsPath())
  fs.symlinkSync(decoy, settingsPath())
  assert.deepStrictEqual(readSettings(), defaultSettings(), 'symlinked side.json read as defaults')
  assert.strictEqual((await call('side')).body.settings.enabled.mail, false, 'route ignores the symlink too')
  fs.rmSync(settingsPath())
  console.log('ok side settings ignore symlink')

  for (const c of SIDE_CHECKS) await c.run()
  const sideDir = path.join(__dirname, 'services/cuckoo/side')
  const code = fs.readdirSync(sideDir).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(sideDir, f), 'utf8')).join('\n')
  assert.ok(!/hosts\.yml|config\.toml|auth\.json|ChatStorage|Envelope Index/.test(code), 'no credential or app-data path in side code')
  console.log('ok side provider checks')

  server.close()
  fs.rmSync(tmp, { recursive: true, force: true })
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
