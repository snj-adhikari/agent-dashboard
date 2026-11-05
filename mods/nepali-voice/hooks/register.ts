import type { Engine, Register } from 'claude-code'
import { detectNepali, translateContext } from './detect'
import { glossaryPhrases, learnStep, parseFix, stageAndFold, understoodAs, type Learnt, type Pending } from './glossary'
import { ne, readVoiceConfig } from './voice'

const FETCH_TIMEOUT_MS = 1500

async function fetchVaultPath($: Engine, url: string): Promise<string | null> {
  const res = await Promise.race([$.http.fetch(url), $.clock.sleep(FETCH_TIMEOUT_MS).then(() => null)])
  if (!res?.ok) return null
  const path = (JSON.parse(res.text) as { settings?: { vaultPath?: unknown } }).settings?.vaultPath
  return typeof path === 'string' && path ? path : null
}

async function folderOf($: Engine): Promise<{ folder: string; home: string }> {
  const home = (await $.env.get('HOME')) ?? ''
  const expand = (p: string) => (p === '~' || p.startsWith('~/') ? home + p.slice(1) : p)
  const custom = await $.env.get('MORE_LIKE_YOU_VAULT')
  if (custom) return { folder: expand(custom), home }
  const root =
    (await $.env.get('VAULT_PATH')) ||
    (await fetchVaultPath($, `${(await $.env.get('AGENT_MONITOR_URL')) ?? 'http://127.0.0.1:5818'}/api/settings`).catch(() => null))
  if (root) return { folder: `${expand(root).replace(/\/$/, '')}/more-like-you`, home }
  return { folder: `${home}/.claude/more-like-you`, home }
}

const readText = async ($: Engine, path: string) => ((await $.fs.exists(path)) ? ((await $.fs.read(path)) as string) : null)
const today = async ($: Engine) => new Date(await $.clock.now()).toISOString().slice(0, 10)
const stage = async ($: Engine, folder: string, rows: readonly Learnt[]) => {
  if (rows.length) await stageAndFold($, folder, rows).catch(() => {})
}

export const register: Register = on => {
  const pending = new Map<string, Pending | null>()
  let folded = false

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'ne', description: 'Speak Nepali: record, transcribe locally, act on the English meaning', argumentHint: '[fix <phrase> = <meaning>]' })
    if (!folded) {
      folded = true
      await stageAndFold($, (await folderOf($)).folder, []).catch(() => {})
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'ne' }, async ($, e) => {
    const { folder, home } = await folderOf($)
    const args = e.args.trim()
    if (args.startsWith('fix')) {
      const fix = parseFix(args)
      if (!fix) return { text: 'Usage: /ne fix <phrase> = <meaning>' }
      await stage($, folder, [{ ...fix, date: await today($), source: 'fix', section: 'learnt' }])
      return { text: `Noted: ${fix.phrase} = ${fix.meaning}` }
    }
    const cfg = readVoiceConfig(await readText($, `${folder}/nepali-voice.json`), home)
    return ne($, cfg, `${home}/.cache/nepali-voice/ne.wav`)
  })

  on('prompt.submit', async ($, e, next) => {
    const origin = (e as unknown as { origin?: { kind: string; name?: string } }).origin
    const own = origin?.kind === 'plugin' && origin.name === 'nepali-voice'
    if ((origin?.kind !== 'composer' && !own) || e.text.trimStart().startsWith('/')) return next(e)
    const { folder } = await folderOf($)
    const md = await readText($, `${folder}/nepali-glossary.md`)
    const nepali = !!detectNepali(e.text, glossaryPhrases(md))
    const sid = await $.session.id()
    const step = learnStep(pending.get(sid) ?? null, { kind: 'prompt', text: e.text, nepali }, await today($))
    pending.set(sid, step.pending)
    await stage($, folder, step.learn)
    return next(nepali ? { ...e, context: [...(e.context ?? []), translateContext(md)] } : e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const t = e as unknown as { agentId?: string; answer?: string }
    if (t.agentId) return next(e)
    const sid = await $.session.id()
    if (pending.get(sid) && t.answer && understoodAs(t.answer)) {
      const step = learnStep(pending.get(sid) ?? null, { kind: 'answer', text: t.answer }, await today($))
      pending.set(sid, step.pending)
      await stage($, (await folderOf($)).folder, step.learn)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    pending.delete(await $.session.id())
    return next(e)
  }).catch(($, e, next) => next(e))
}
