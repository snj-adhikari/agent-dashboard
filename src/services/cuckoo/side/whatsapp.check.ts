import assert from 'assert'
import { CuckooError } from '../relayLog'
import { defaultSettings } from './config'
import { composeUrl, parseBadge, provider, providers, whatsappDeps } from './whatsapp'

export async function run(): Promise<void> {
  assert.ok(providers.length > 0, 'whatsapp exports providers')
  const saved = { ...whatsappDeps }
  const opened: string[][] = []
  let badge: () => Promise<string> = async () => '3'
  const osaArgs: string[][] = []
  whatsappDeps.platform = 'darwin'
  whatsappDeps.installed = () => true
  whatsappDeps.open = async (args: string[]) => void opened.push(args)
  whatsappDeps.osa = async (_s: string, args: string[] = []) => (osaArgs.push(args), badge())
  try {
    const text = 'hi & bye? 100% #1 "quoted" é'
    assert.strictEqual(composeUrl(text), 'whatsapp://send?text=hi%20%26%20bye%3F%20100%25%20%231%20%22quoted%22%20%C3%A9')
    await provider.action('compose', null, text, defaultSettings())
    assert.deepStrictEqual(opened, [[composeUrl(text)]], 'compose only opens the composer url')
    assert.deepStrictEqual(provider.actions, ['compose'], 'no send action')
    await assert.rejects(provider.action('send', null, 'x', defaultSettings()), (e: unknown) => e instanceof CuckooError && e.code === 'bad_request')
    console.log('ok whatsapp compose url encoded')

    assert.deepStrictEqual([parseBadge(''), parseBadge('7'), parseBadge('99+'), parseBadge('•'), parseBadge('absent')], [0, 7, 99, -1, null])
    assert.strictEqual((await provider.data(defaultSettings()))?.items[0].value, '3')
    assert.deepStrictEqual(osaArgs.at(-1), ['WhatsApp'], 'app name passed as argv')
    badge = async () => {
      throw Object.assign(new Error('Command failed'), { stderr: 'System Events got an error: osascript is not allowed assistive access. (-25211)' })
    }
    assert.strictEqual((await provider.status(defaultSettings())).reason, 'no_permission')
    await assert.rejects(provider.data(defaultSettings()), (e: unknown) => e instanceof CuckooError && e.code === 'no_permission')
    whatsappDeps.installed = () => false
    assert.strictEqual((await provider.status(defaultSettings())).reason, 'not_installed')
    console.log('ok whatsapp badge and no_permission')
  } finally {
    Object.assign(whatsappDeps, saved)
  }
}
