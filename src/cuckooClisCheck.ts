import assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { cliInfo, KNOWN_CLIS, signedInOf } from './services/cuckoo/clis'
import { AGENT_BINARIES } from './services/processes'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cuckoo-clis-'))
const log = path.join(tmp, 'calls.log')
const stub = (name: string, body: string): string => {
  const file = path.join(tmp, name)
  fs.writeFileSync(file, `#!/bin/sh\necho "${name} $*" >> '${log}'\n[ "$1" = --version ] && { echo '${name} 1.0'; exit 0; }\n${body}\n`, { mode: 0o755 })
  return file
}
const SLOW_OK = 15_000
const calls = (): string[] => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [])

const bins = {
  claude: stub('claude', 'exit 0'),
  opencode: stub('opencode', 'exit 0'),
  codex: stub('codex', 'exit 1'),
  gemini: stub('gemini', 'exit 0'),
  copilot: stub('copilot', 'exit 0'),
  slow: stub('cursor-agent', 'sleep 10'),
}

async function main(): Promise<void> {
  for (const bin of ['claude', 'copilot', 'codex', 'gemini', 'cursor-agent', 'opencode', 'antigravity', 'agentastic']) {
    assert.ok(AGENT_BINARIES.includes(bin), `pgrep covers ${bin}`)
  }
  assert.ok(AGENT_BINARIES.every((b) => b.length <= 16), 'names fit macOS 16-char comm for pgrep -x')
  console.log('ok processes binaries list')

  assert.strictEqual(await signedInOf('claude', bins.claude, SLOW_OK), true)
  assert.strictEqual(await signedInOf('opencode', bins.opencode, SLOW_OK), true)
  assert.strictEqual(await signedInOf('codex', bins.codex, SLOW_OK), false)
  assert.strictEqual(await signedInOf('gemini', bins.gemini, SLOW_OK), 'unknown', 'no status command')
  assert.strictEqual(await signedInOf('copilot', bins.copilot, SLOW_OK), 'unknown', 'no status command')
  assert.strictEqual(await signedInOf('claude', path.join(tmp, 'missing'), SLOW_OK), 'unknown', 'missing binary')
  assert.deepStrictEqual(calls(), ['claude auth status --json', 'opencode auth list', 'codex login status'], 'only status commands run; gemini/copilot never called')
  const info = await cliInfo('claude', bins.claude)
  assert.deepStrictEqual({ ...info, path: '' }, { cli: 'claude', path: '', version: 'claude 1.0', signedIn: true, chat: true })
  assert.strictEqual((await cliInfo('codex', bins.codex)).chat, false, 'signed-out CLI not offered for chat')
  assert.ok(KNOWN_CLIS.every((c) => AGENT_BINARIES.includes(c)), 'every known CLI is also scanned')
  console.log('ok clis signedIn from exit code')

  const t0 = Date.now()
  assert.strictEqual(await signedInOf('cursor-agent', bins.slow, 1000), 'unknown')
  const took = Date.now() - t0
  assert.ok(took >= 900 && took < 4000, `1 s cap, took ${took} ms`)
  console.log('ok clis timeout is unknown')
  fs.rmSync(tmp, { recursive: true, force: true })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
