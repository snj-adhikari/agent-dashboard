import assert from 'assert'
import { CuckooError } from '../relayLog'
import { defaultSettings } from './config'
import { MAX_BODY, cryptoDeps, portfolio, prices, provider, providers, resetCryptoCache } from './crypto'

export async function run(): Promise<void> {
  assert.ok(providers.length > 0, 'crypto exports providers')
  const saved = { ...cryptoDeps }
  const urls: string[] = []
  let status = 200
  let t = 0
  cryptoDeps.now = () => t
  cryptoDeps.fetch = async (url: string) => {
    urls.push(url)
    return new Response(JSON.stringify({ btc: { aud: 100000 }, eth: { aud: 4000.5 } }), { status })
  }
  resetCryptoCache()
  try {
    const settings = { ...defaultSettings(), holdings: [{ symbol: 'BTC', amount: 0.5 }, { symbol: 'ETH', amount: 2 }, { symbol: 'NOPE', amount: 1 }] }
    assert.strictEqual(settings.currency, 'AUD')
    const data = await provider.data(settings)
    assert.deepStrictEqual(data?.items.map((i) => [i.id, i.value, i.tone]), [['BTC', 'AUD 50,000.00', null], ['ETH', 'AUD 8,001.00', null], ['NOPE', null, 'warn']])
    assert.strictEqual(data?.summary, 'Total AUD 58,001.00')
    assert.strictEqual(urls[0], 'https://api.coingecko.com/api/v3/simple/price?symbols=btc%2Ceth%2Cnope&vs_currencies=aud')
    assert.strictEqual(portfolio([], {}, 'AUD').summary, 'Total AUD 0.00')
    assert.strictEqual(await provider.data(defaultSettings()), null, 'no holdings, no request')
    assert.strictEqual(urls.length, 1)
    console.log('ok crypto totals aud')

    t = 59_999
    await prices(['ETH', 'BTC', 'NOPE'], 'AUD')
    assert.strictEqual(urls.length, 1, 'cached within 60 s')
    t = 60_000
    await prices(['BTC', 'ETH', 'NOPE'], 'AUD')
    assert.strictEqual(urls.length, 2, 'refetched after 60 s')
    await prices(['BTC', 'ETH', 'NOPE'], 'USD')
    assert.strictEqual(urls.length, 3, 'currency change is a new key')
    console.log('ok crypto price cache 60s')

    resetCryptoCache()
    status = 401
    await assert.rejects(prices(['BTC'], 'AUD'), (e: unknown) => e instanceof CuckooError && e.code === 'needs_key')
    assert.strictEqual((await provider.status(settings)).reason, 'needs_key')
    status = 500
    await assert.rejects(prices(['BTC'], 'AUD'), (e: unknown) => e instanceof CuckooError && e.code === 'host_failed')
    console.log('ok crypto needs_key')

    resetCryptoCache()
    const huge = JSON.stringify({ btc: { aud: 1 }, pad: 'x'.repeat(MAX_BODY) })
    let pulled = 0
    cryptoDeps.fetch = async () =>
      new Response(
        new ReadableStream({
          pull(c) {
            pulled++
            if (pulled > 100) return c.close()
            c.enqueue(new TextEncoder().encode(huge.slice(0, 16 * 1024)))
          },
        }),
        { status: 200 },
      )
    await assert.rejects(prices(['BTC'], 'AUD'), (e: unknown) => e instanceof CuckooError && e.code === 'not_installed', 'streamed body over 64 KB rejected')
    assert.ok(pulled < 10, `stopped reading early (${pulled} chunks)`)
    cryptoDeps.fetch = async () => new Response(huge, { status: 200, headers: { 'content-length': String(huge.length) } })
    await assert.rejects(prices(['BTC'], 'AUD'), (e: unknown) => e instanceof CuckooError && e.code === 'not_installed', 'declared length over 64 KB rejected')
    cryptoDeps.fetch = async () => new Response('{not json', { status: 200 })
    await assert.rejects(prices(['BTC'], 'AUD'), (e: unknown) => e instanceof CuckooError && e.code === 'host_failed', 'bad JSON is host_failed')
    console.log('ok crypto response size cap')
  } finally {
    Object.assign(cryptoDeps, saved)
    resetCryptoCache()
  }
}
