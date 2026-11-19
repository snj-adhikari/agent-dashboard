import assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { chat, chatDeps, chatEnd, HEADLESS, sweepIdle } from './services/cuckoo/chat'
import { CHAT_CLIS } from './services/cuckoo/clis'
import { CuckooError } from './services/cuckoo/relayLog'
import type { CliInfo } from './services/cuckoo/clis'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-chat-'))
const argvLog = path.join(tmp, 'argv.log')
const stdinLog = path.join(tmp, 'stdin.log')
const pidFile = path.join(tmp, 'pid')
const stub = path.join(tmp, 'claude')
fs.writeFileSync(
  stub,
  `#!/bin/sh\necho "$*" >> '${argvLog}'\ncat > '${stdinLog}'\necho $$ > '${pidFile}'\n[ -f '${tmp}/hang' ] && exec sleep 30\necho "reply to: $(tail -n 1 '${stdinLog}')"\n`,
  { mode: 0o755 }
)

let signedIn: CliInfo['signedIn'] = true
chatDeps.clis = async () => [{ cli: 'claude', path: stub, version: '1.0', signedIn, chat: signedIn === true }]

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const waitPid = async (): Promise<number> => {
  for (let i = 0; i < 50 && !fs.existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 50))
  return Number(fs.readFileSync(pidFile, 'utf8'))
}
const waitDead = async (pid: number): Promise<boolean> => {
  for (let i = 0; i < 40 && alive(pid); i++) await new Promise((r) => setTimeout(r, 50))
  return !alive(pid)
}
const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p
    return 'ok'
  } catch (e) {
    return e instanceof CuckooError ? `${e.code} ${e.status}` : String(e)
  }
}

async function main(): Promise<void> {
  assert.ok(CHAT_CLIS.length > 0 && CHAT_CLIS.every((c) => (HEADLESS[c]?.length ?? 0) > 0), 'every CHAT_CLIS entry has HEADLESS args')
  assert.deepStrictEqual(Object.keys(HEADLESS).sort(), [...CHAT_CLIS].sort(), 'HEADLESS keyed the same as CHAT_CLIS')
  console.log('ok chat clis have headless args')

  const secret = 'please-keep-this-off-argv-42'
  const first = (await chat({ cli: 'claude', text: secret })) as { conversationId: string; text: string; cli: string }
  assert.strictEqual(first.text, `reply to: ${secret}`)
  assert.strictEqual(first.cli, 'claude')
  assert.ok(!fs.readFileSync(argvLog, 'utf8').includes(secret), 'prompt never on argv')
  assert.ok(fs.readFileSync(argvLog, 'utf8').includes('--tools Read,Glob,Grep'), 'read-only tools')
  assert.strictEqual(fs.readFileSync(stdinLog, 'utf8'), secret, 'prompt on stdin')
  await chat({ cli: 'claude', text: 'second', conversationId: first.conversationId })
  const second = fs.readFileSync(stdinLog, 'utf8')
  assert.ok(second.includes(`User: ${secret}`) && second.includes(`Assistant: reply to: ${secret}`), 'history carried in memory')
  console.log('ok chat stdin not argv')

  signedIn = false
  assert.strictEqual(await codeOf(chat({ cli: 'claude', text: 'hi' })), 'signed_out 409')
  signedIn = 'unknown'
  assert.strictEqual(await codeOf(chat({ cli: 'claude', text: 'hi' })), 'signed_out 409')
  signedIn = true
  console.log('ok chat signed_out')

  fs.writeFileSync(path.join(tmp, 'hang'), '')
  fs.rmSync(pidFile, { force: true })
  chatDeps.timeoutMs = 600
  const timedOut = codeOf(chat({ text: 'hang' }))
  const pid1 = await waitPid()
  const t0 = Date.now()
  assert.strictEqual(await timedOut, 'timeout 504')
  assert.ok(Date.now() - t0 < 10_000, 'timeout fires on time')
  assert.ok(await waitDead(pid1), 'timed-out child killed')
  console.log('ok chat timeout kills child')

  chatDeps.timeoutMs = 120_000
  fs.rmSync(pidFile, { force: true })
  const pending = codeOf(chat({ text: 'hang', conversationId: 'end-me' }))
  const pid2 = await waitPid()
  assert.strictEqual(await codeOf(chat({ text: 'again', conversationId: 'end-me' })), 'stale 409', 'one child per conversation')
  assert.deepStrictEqual(await chatEnd({ conversationId: 'end-me' }), { ok: true })
  assert.strictEqual(await pending, 'stale 409')
  assert.ok(await waitDead(pid2), 'ended child killed')
  console.log('ok chat end kills child')

  fs.rmSync(pidFile, { force: true })
  const hanging = codeOf(chat({ text: 'hang', conversationId: 'idle-run' }))
  const pid3 = await waitPid()
  fs.rmSync(path.join(tmp, 'hang'))
  await chat({ text: 'remember me', conversationId: 'idle-done' })
  chatDeps.idleMs = 2000
  sweepIdle()
  assert.ok(alive(pid3), 'not evicted before the idle TTL')
  await new Promise((r) => setTimeout(r, 2100))
  sweepIdle()
  assert.strictEqual(await hanging, 'stale 409', 'idle running conversation ended')
  assert.ok(await waitDead(pid3), 'idle child killed')
  chatDeps.idleMs = 30 * 60_000
  await chat({ text: 'fresh', conversationId: 'idle-done' })
  assert.strictEqual(fs.readFileSync(stdinLog, 'utf8'), 'fresh', 'idle history dropped')
  console.log('ok chat idle evicts')

  fs.rmSync(tmp, { recursive: true, force: true })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
