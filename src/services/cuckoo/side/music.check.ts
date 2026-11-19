import assert from 'assert'
import { CuckooError } from '../relayLog'
import { clearMusicCache, currentMusic, musicDeps, parseNowPlaying, parseRunning, provider, providers } from './music'
import { defaultSettings } from './config'

export async function run(): Promise<void> {
  assert.ok(providers.length > 0, 'music exports providers')
  const saved = { ...musicDeps }
  const calls: { script: string; args: string[] }[] = []
  let running = 'Music\nSpotify'
  let t = 1000
  musicDeps.platform = 'darwin'
  musicDeps.now = () => t
  musicDeps.osa = async (script: string, args: string[] = []) => {
    calls.push({ script, args })
    if (script.includes('System Events')) return running
    if (script.includes('application "Music"') && script.includes('player state')) return 'paused\tSong A\tArtist A\t215000\t12500'
    if (script.includes('application "Spotify"') && script.includes('player state')) return 'playing\tSong B\t\t180000\t4000'
    return ''
  }
  try {
    assert.deepStrictEqual(parseNowPlaying('music', 'playing\tTitle\tWho\t1000\t250'), { player: 'music', playing: true, title: 'Title', artist: 'Who', durationMs: 1000, positionMs: 250 })
    assert.strictEqual(parseNowPlaying('music', 'stopped'), null, 'stopped is null')
    assert.strictEqual(parseNowPlaying('spotify', 'garbage'), null, 'junk is null')
    assert.deepStrictEqual(parseRunning('Spotify\n'), ['spotify'])
    assert.deepStrictEqual(parseRunning(''), [], 'nothing running')

    clearMusicCache()
    assert.deepStrictEqual(await currentMusic(), { player: 'spotify', playing: true, title: 'Song B', artist: null, durationMs: 180000, positionMs: 4000 }, 'playing wins over paused')
    const n = calls.length
    t += 1500
    await currentMusic()
    assert.strictEqual(calls.length, n, '2 s cache')
    t += 1000
    running = ''
    clearMusicCache()
    assert.strictEqual(await currentMusic(), null, 'no running player, no query')
    assert.ok(!calls.slice(n).some((c) => c.script.includes('player state')), 'a player that is not running is never addressed')
    assert.ok(calls.every((c) => !c.script.includes('launch') && !c.script.includes('activate')), 'never launches or raises')
    console.log('ok music applescript parse')

    running = 'Music'
    clearMusicCache()
    calls.length = 0
    for (const [action, verb] of [['play', 'play'], ['pause', 'pause'], ['next', 'next track'], ['prev', 'previous track']]) {
      await provider.action(action, 'music', null, defaultSettings())
      assert.strictEqual(calls.at(-1)?.script, `tell application "Music" to ${verb}`, action)
    }
    assert.deepStrictEqual(provider.actions, ['play', 'pause', 'next', 'prev'], 'allow-list')
    await assert.rejects(provider.action('quit', 'music', null, defaultSettings()), (e: unknown) => e instanceof CuckooError && e.code === 'bad_request')
    await assert.rejects(provider.action('play', 'spotify', null, defaultSettings()), (e: unknown) => e instanceof CuckooError && e.code === 'not_installed', 'player not running is refused')
    assert.ok(calls.every((c) => c.args.length === 0), 'no argv-built scripts')
    console.log('ok music actions allow-list')
  } finally {
    Object.assign(musicDeps, saved)
    clearMusicCache()
  }
}
