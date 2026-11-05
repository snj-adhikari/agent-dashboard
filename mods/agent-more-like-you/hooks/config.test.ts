import { expect, test } from 'claude-code/testing'
import { readConfig, resolveFolder } from './config'

const env = (m: Record<string, string>) => (k: string) => m[k]
const none = async () => null

test('readConfig: missing file gives defaults', () => {
  const c = readConfig(null)
  expect(c.backfillDays).toBe(90)
  expect(c.staleDays).toBe(7)
  expect(c.threshold).toBeNull()
  expect(c.notesDir).toBeNull()
  expect(c.autoRefresh).toBe('local')
  expect(c.judgeLimit).toBe(300)
  expect(c.perspective).toBe(true)
  expect(readConfig('{"perspective":false}').perspective).toBe(false)
  expect(c.sources.notes).toBe(true)
  expect(c.sources.prompts).toBe(true)
  expect(Object.values(c.audiences).every(Boolean)).toBe(true)
})

test('readConfig: honours valid keys, ignores bad types and bad JSON', () => {
  const c = readConfig(
    JSON.stringify({ sources: { slack: false, prompts: 'no' }, audiences: { jira: false }, staleDays: 'x', threshold: 0.6, notesDir: '/n', autoRefresh: 'full', judgeLimit: 50 }),
  )
  expect(c.sources.slack).toBe(false)
  expect(c.sources.prompts).toBe(true)
  expect(c.sources.notes).toBe(true)
  expect(c.audiences.jira).toBe(false)
  expect(c.audiences['slack-dm']).toBe(true)
  expect([c.staleDays, c.threshold, c.autoRefresh, c.judgeLimit]).toEqual([7, 0.6, 'full', 50])
  expect(readConfig('{nope').backfillDays).toBe(90)
})

test('MORE_LIKE_YOU_VAULT is the folder itself and wins', async () => {
  const r = await resolveFolder(env({ MORE_LIKE_YOU_VAULT: '~/style', VAULT_PATH: '/v' }), '/h', none)
  expect(r).toEqual({ folder: '/h/style', vaultRoot: null })
})

test('VAULT_PATH is the root', async () => {
  expect(await resolveFolder(env({ VAULT_PATH: '/v/' }), '/h', none)).toEqual({ folder: '/v/more-like-you', vaultRoot: '/v' })
})

test('dashboard setting is used, honouring AGENT_MONITOR_URL, with ~ expanded', async () => {
  const urls: string[] = []
  const fetchPath = async (u: string) => (urls.push(u), '~/notes')
  expect(await resolveFolder(env({}), '/h', fetchPath)).toEqual({ folder: '/h/notes/more-like-you', vaultRoot: '/h/notes' })
  await resolveFolder(env({ AGENT_MONITOR_URL: 'http://x:1' }), '/h', fetchPath)
  expect(urls).toEqual(['http://127.0.0.1:5818/api/settings', 'http://x:1/api/settings'])
})

test('empty, null or throwing dashboard falls through to ~/.claude/more-like-you', async () => {
  const want = { folder: '/h/.claude/more-like-you', vaultRoot: null }
  expect(await resolveFolder(env({}), '/h', async () => null)).toEqual(want)
  expect(await resolveFolder(env({}), '/h', async () => '')).toEqual(want)
  expect(await resolveFolder(env({}), '/h', async () => { throw new Error('down') })).toEqual(want)
})
