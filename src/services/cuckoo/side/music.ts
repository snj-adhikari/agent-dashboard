import { execFile } from 'child_process'
import type { Music, SideItem } from '../agents'
import { CuckooError } from '../relayLog'
import type { Provider } from './registry'

type Player = Music['player']

/** Runs a fixed AppleScript; values only ever reach it as argv to `on run argv`. */
export function osa(script: string, args: string[] = [], timeoutMs = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script, ...args], { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr: String(stderr) }))
      else resolve(String(stdout).trim())
    })
  })
}

const RUNNING = `on run argv
tell application "System Events" to set names to name of every process whose name is "Music" or name is "Spotify"
set AppleScript's text item delimiters to linefeed
return names as text
end run`

const NOW_PLAYING: Record<Player, string> = {
  music: `tell application "Music"
set st to player state as string
if st is "stopped" then return st
set t to current track
return st & tab & (name of t) & tab & (artist of t) & tab & ((duration of t) * 1000 as integer) & tab & ((player position) * 1000 as integer)
end tell`,
  spotify: `tell application "Spotify"
set st to player state as string
if st is "stopped" then return st
set t to current track
return st & tab & (name of t) & tab & (artist of t) & tab & (duration of t) & tab & ((player position) * 1000 as integer)
end tell`,
}

const APP: Record<Player, string> = { music: 'Music', spotify: 'Spotify' }
const VERBS = { play: 'play', pause: 'pause', next: 'next track', prev: 'previous track' } as const
type Verb = keyof typeof VERBS
const ACTION_SCRIPTS = Object.fromEntries(
  (Object.keys(APP) as Player[]).map((p) => [p, Object.fromEntries((Object.keys(VERBS) as Verb[]).map((v) => [v, `tell application "${APP[p]}" to ${VERBS[v]}`]))]),
) as Record<Player, Record<Verb, string>>

export const musicDeps = { osa, now: (): number => Date.now(), platform: process.platform as string }

const toInt = (s: string | undefined): number | null => {
  const n = Number(s)
  return s && Number.isFinite(n) ? Math.round(n) : null
}

/** Parses the tab-separated now-playing line; `stopped` or junk gives null. */
export function parseNowPlaying(player: Player, out: string): Music | null {
  const [state, title, artist, dur, pos] = out.split('\t')
  if ((state !== 'playing' && state !== 'paused') || !title) return null
  return { player, playing: state === 'playing', title, artist: artist || null, durationMs: toInt(dur), positionMs: toInt(pos) }
}

export const parseRunning = (out: string): Player[] => {
  const names = out.split(/\r?\n/).map((s) => s.trim())
  return (Object.keys(APP) as Player[]).filter((p) => names.includes(APP[p]))
}

const CACHE_MS = 2000
let cache: { at: number; value: Music | null } | null = null
export const clearMusicCache = (): void => {
  cache = null
}

/** Never launches a player: only apps System Events already lists are queried; a playing one wins over a paused one. */
export async function currentMusic(): Promise<Music | null> {
  if (musicDeps.platform !== 'darwin') return null
  const now = musicDeps.now()
  if (cache && now - cache.at < CACHE_MS) return cache.value
  const running = parseRunning(await musicDeps.osa(RUNNING))
  const found: Music[] = []
  for (const p of running) {
    const m = await musicDeps.osa(NOW_PLAYING[p]).then((out) => parseNowPlaying(p, out), () => null)
    if (m) found.push(m)
  }
  const value = found.find((m) => m.playing) ?? found[0] ?? null
  cache = { at: now, value }
  return value
}

const ACTIONS: Verb[] = ['play', 'pause', 'next', 'prev']

export const provider: Provider = {
  id: 'music',
  actions: ACTIONS,
  async status() {
    if (musicDeps.platform !== 'darwin') return { available: false, via: null, reason: 'unsupported_os' }
    return { available: true, via: 'applescript', reason: null }
  },
  async data() {
    const m = await currentMusic()
    if (!m) return { items: [], summary: null }
    const item: SideItem = {
      id: m.player,
      title: m.title,
      subtitle: m.artist,
      value: m.playing ? 'playing' : 'paused',
      url: null,
      tone: null,
      group: null,
      actions: [m.playing ? 'pause' : 'play', 'next', 'prev'],
    }
    return { items: [item], summary: null }
  },
  async action(action, itemId) {
    const target = itemId === 'music' || itemId === 'spotify' ? itemId : (await currentMusic())?.player
    if (!target || !parseRunning(await musicDeps.osa(RUNNING)).includes(target)) throw new CuckooError('not_installed', 'no music player is running')
    if (action === 'open') return null
    if (!(ACTIONS as string[]).includes(action)) throw new CuckooError('bad_request', `music does not allow ${action}`)
    await musicDeps.osa(ACTION_SCRIPTS[target][action as Verb])
    clearMusicCache()
    return null
  },
}

export const providers = [provider]
