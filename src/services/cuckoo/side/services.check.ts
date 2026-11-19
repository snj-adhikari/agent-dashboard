import assert from 'assert'
import { defaultSettings } from './config'
import { CuckooError } from '../relayLog'
import { isToolName } from '../chat'
import { ARGV, CACHE_MS, CONNECTORS, MAX_REPLY, NO_ACCESS, clearServicesCache, providers, servicesDeps } from './services'

servicesDeps.which = () => null
servicesDeps.exec = async () => ({ code: 1, stdout: '' })
servicesDeps.headless = async () => NO_ACCESS
servicesDeps.openUrl = () => undefined

const WRITE_VERBS = /\b(deploy|create|delete|remove|rm|update|post|put|patch|import|activate|deactivate|execute|mutation|login|logout|config|link|env|promote|rollback|refund|trigger)\b/i

export async function run(): Promise<void> {
  const settings = defaultSettings()
  const byId = new Map(providers.map((p) => [p.id, p]))
  const saved = { ...servicesDeps }
  clearServicesCache()
  const calls: { bin: string; args: string[]; timeoutMs: number }[] = []
  const prompts: { prompt: string; tools: string[] | undefined }[] = []
  const opened: string[] = []
  let installed = new Set(['gh', 'vercel', 'stripe', 'n8n', 'claude'])
  let exitOf: (bin: string, args: string[]) => number | null = () => 0
  let stdoutOf: (bin: string, args: string[]) => string = () => ''
  let clock = 1_000_000
  let reply = '[]'
  servicesDeps.which = (bin) => (installed.has(bin) ? `/opt/homebrew/bin/${bin}` : null)
  servicesDeps.exec = async (bin, args, timeoutMs) => {
    calls.push({ bin, args: [...args], timeoutMs })
    return { code: exitOf(bin, [...args]), stdout: stdoutOf(bin, [...args]) }
  }
  servicesDeps.headless = async (prompt, opts) => {
    prompts.push({ prompt, tools: opts?.allowedTools })
    return reply
  }
  servicesDeps.openUrl = (url) => void opened.push(url)
  servicesDeps.now = () => clock
  try {
    assert.deepStrictEqual(providers.map((p) => p.id), ['github', 'vercel', 'stripe', 'n8n', 'resend', 'notion', 'calcom'], 'one provider per service id')

    const gh = byId.get('github')!
    const ghData = JSON.stringify({ data: { viewer: { pullRequests: { nodes: [{ number: 7, title: 'Mine', url: 'https://github.com/o/r/pull/7', repository: { nameWithOwner: 'o/r' }, commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] } }] } }, search: { nodes: [{ number: 3, title: 'Review me', url: 'javascript:alert(1)', repository: { nameWithOwner: 'o/s' } }, {}] } } })
    stdoutOf = (bin, args) => (bin.endsWith('/gh') && args[0] === 'api' ? ghData : '')
    assert.deepStrictEqual(await gh.status(settings), { available: true, via: 'cli', reason: null })
    assert.deepStrictEqual(calls[0], { bin: '/opt/homebrew/bin/gh', args: ['auth', 'status', '--active'], timeoutMs: 3000 }, 'gh status argv with 3 s timeout')
    const items = (await gh.data(settings))!.items
    assert.deepStrictEqual(calls[1].args.slice(0, 3), ['api', 'graphql', '-f'])
    assert.ok(calls[1].args[3].startsWith('query=query{') && !/mutation/i.test(calls[1].args[3]), 'gh graphql is a fixed read query')
    assert.deepStrictEqual(items.map((i) => [i.group, i.title, i.tone, i.url]), [['review', 'Review me', null, null], ['mine', 'Mine', 'error', 'https://github.com/o/r/pull/7']], 'review requests then my PRs with checks; non-https url dropped')
    console.log('ok services gh args')

    for (const [id, spec] of Object.entries(ARGV)) {
      const lists: (readonly string[] | null)[] = [spec.status, ...spec.data]
      for (const argv of lists.filter((a): a is readonly string[] => !!a)) {
        const verbs = argv.filter((a) => !a.startsWith('query='))
        assert.ok(!verbs.some((a) => WRITE_VERBS.test(a)), `${id} argv is read-only: ${argv.join(' ')}`)
      }
    }
    assert.ok(!ARGV.stripe.data.some((a) => a[0] !== 'get'), 'stripe only issues GET')
    for (const p of providers) {
      assert.deepStrictEqual(p.actions, [], `${p.id} has no extra actions`)
      assert.ok((await p.action('deploy', null, null, settings).catch((e) => e)) instanceof CuckooError, `${p.id} refuses deploy`)
    }
    const execd = calls.map((c) => [c.bin.split('/').pop(), ...c.args].join(' '))
    const allowed = new Set(Object.values(ARGV).flatMap((s) => [s.status, ...s.data].filter(Boolean).map((a) => [s.bin, ...a!].join(' '))))
    assert.ok(execd.every((c) => allowed.has(c)), 'every exec came from the allow-list')
    await gh.action('open', 'mine:o/r#7', null, settings)
    assert.deepStrictEqual(opened, ['https://github.com/o/r/pull/7'], 'open uses the cached https url only')
    assert.ok((await gh.action('open', 'review:o/s#3', null, settings).catch((e) => e)) instanceof CuckooError, 'item without a safe url cannot be opened')
    console.log('ok services read-only verbs')

    calls.length = 0
    await gh.status(settings)
    assert.strictEqual(calls.length, 0, 'status cached')
    clock += CACHE_MS + 1
    exitOf = (bin) => (bin.endsWith('/vercel') || bin.endsWith('/gh') ? 1 : 0)
    assert.deepStrictEqual(await gh.status(settings), { available: false, via: 'cli', reason: 'signed_out' }, 'cache expires after 5 min, non-zero exit is signed_out')
    assert.strictEqual((await byId.get('vercel')!.status(settings)).reason, 'signed_out')
    assert.deepStrictEqual(calls.map((c) => c.args), [['auth', 'status', '--active'], ['whoami']])
    assert.strictEqual(((await gh.data(settings).catch((e) => e)) as CuckooError).code, 'signed_out', 'data refuses when signed out')
    clearServicesCache()
    exitOf = () => null
    assert.strictEqual((await byId.get('stripe')!.status(settings)).reason, 'signed_out', 'timeout reports signed_out')
    exitOf = () => 0
    assert.deepStrictEqual(await byId.get('stripe')!.status(settings), { available: true, via: 'cli', reason: null }, 'timeout not cached')
    installed = new Set(['claude'])
    clearServicesCache()
    for (const id of ['github', 'vercel', 'stripe', 'n8n'] as const) assert.strictEqual((await byId.get(id)!.status(settings)).reason, 'not_installed', `${id} missing`)
    console.log('ok services signed_out')

    installed = new Set(['stripe', 'n8n', 'vercel', 'claude'])
    clearServicesCache()
    calls.length = 0
    stdoutOf = (_bin, args) =>
      args[1] === '/v1/balance' ? JSON.stringify({ available: [{ amount: 12345, currency: 'aud' }] }) : args[1] === '/v1/charges' ? JSON.stringify({ data: [{ id: 'ch_1', amount: 500, currency: 'aud', status: 'succeeded', description: 'Tea' }] }) : args[0] === 'list:workflow' ? 'abc|Daily sync\nnot a row\n' : args[0] === 'list' ? JSON.stringify({ deployments: [{ uid: 'dpl_1', name: 'site', url: 'site-abc.vercel.app', state: 'READY' }] }) : ''
    assert.deepStrictEqual((await byId.get('stripe')!.data(settings))!.items.map((i) => [i.title, i.value, i.tone]), [['Available balance', '123.45 AUD', null], ['Tea', '5.00 AUD', 'ok']])
    assert.deepStrictEqual(calls.filter((c) => c.args[1] === '/v1/charges')[0].args, ['get', '/v1/charges', '--limit', '5'], 'last 5 charges')
    assert.deepStrictEqual((await byId.get('n8n')!.data(settings))!.items.map((i) => [i.id, i.title]), [['abc', 'Daily sync']])
    assert.strictEqual(calls.filter((c) => c.bin.endsWith('/n8n')).length, 1, 'n8n has no status command, installed is enough')
    assert.deepStrictEqual((await byId.get('vercel')!.data(settings))!.items.map((i) => [i.title, i.url, i.tone]), [['site', 'https://site-abc.vercel.app', 'ok']])
    console.log('ok services stripe vercel n8n parse')

    clearServicesCache()
    calls.length = 0
    stdoutOf = (_bin, args) => (args[2] === CONNECTORS.notion.name ? 'claude.ai Notion:\n  Scope: claude.ai config\n  Status: ✔ Connected\n' : args[2] === CONNECTORS.calcom.name ? 'Status: ! Needs authentication' : '')
    exitOf = (_bin, args) => (args[2] === CONNECTORS.resend.name ? 1 : 0)
    assert.deepStrictEqual(await byId.get('notion')!.status(settings), { available: true, via: 'mcp', reason: null })
    assert.strictEqual((await byId.get('calcom')!.status(settings)).reason, 'needs_key', 'connector not signed in')
    assert.strictEqual((await byId.get('resend')!.status(settings)).reason, 'needs_key', 'resend without a connector')
    assert.deepStrictEqual(calls.map((c) => c.args.slice(0, 2)), [['mcp', 'get'], ['mcp', 'get'], ['mcp', 'get']], 'connector probe only reads mcp config')
    installed = new Set()
    clearServicesCache()
    assert.strictEqual((await byId.get('notion')!.status(settings)).reason, 'needs_key', 'no claude means needs_key')
    installed = new Set(['claude'])
    clearServicesCache()
    reply = 'Here: [{"title":"Roadmap","subtitle":"edited today","url":"https://notion.so/x"},{"title":"Bad","url":"file:///etc/passwd"}]'
    const notion = (await byId.get('notion')!.data(settings))!.items
    assert.deepStrictEqual(notion.map((i) => [i.title, i.url]), [['Roadmap', 'https://notion.so/x'], ['Bad', null]], 'model output filtered to https urls')
    assert.deepStrictEqual(prompts[0].tools, CONNECTORS.notion.tools, 'only the notion read tools')
    assert.ok(prompts[0].tools!.every((t) => t.startsWith('mcp__claude_ai_Notion__') && /search|fetch/.test(t)))
    assert.ok(CONNECTORS.calcom.tools.every((t) => t.startsWith('mcp__claude_ai_Cal') && /get|list/.test(t)))
    assert.ok([...CONNECTORS.notion.tools, 'mcp__claude_ai_Notion__notion-search'].every(isToolName), 'hyphenated connector tool names accepted')
    for (const bad of ['--flag', '-x', 'mcp__x__a b', 'Read,Bash', 'mcp__x__"a"', "mcp__x__'a'", '']) assert.ok(!isToolName(bad), `tool name ${JSON.stringify(bad)} rejected`)
    reply = '[{"title":"NO_ACCESS review notes","url":"https://notion.so/n"}]'
    assert.deepStrictEqual((await byId.get('notion')!.data(settings))!.items.map((i) => i.title), ['NO_ACCESS review notes'], 'NO_ACCESS inside a title is data')
    reply = `[{"title":"A"}]${' '.repeat(MAX_REPLY)}[{"title":"B"}]`
    assert.deepStrictEqual((await byId.get('notion')!.data(settings))!.items.map((i) => i.title), ['A'], 'reply capped before parsing')
    reply = `Sorry.\n${NO_ACCESS}\n`
    assert.strictEqual(((await byId.get('notion')!.data(settings).catch((e) => e)) as CuckooError).code, 'needs_key', 'NO_ACCESS on its own line')
    reply = NO_ACCESS
    assert.strictEqual(((await byId.get('notion')!.data(settings).catch((e) => e)) as CuckooError).code, 'needs_key', 'denied connector is needs_key')
    console.log('ok services connectors needs_key')
    console.log('ok runHeadless tool names')
  } finally {
    Object.assign(servicesDeps, saved)
    clearServicesCache()
  }
}
