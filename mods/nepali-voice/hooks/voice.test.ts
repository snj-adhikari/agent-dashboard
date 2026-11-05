import { expect, test } from 'claude-code/testing'
import type { EngineInterface as Engine } from 'claude-code'
import { needsConfirm, ne, parseWhisperJson, readVoiceConfig } from './voice'

const WAV = '/t/ne.wav'
const NE_TEXT = 'यो एउटा परीक्षण हो'
const whisper = (text: string, p: number) => JSON.stringify({ transcription: [{ text, tokens: [{ text: '[_BEG_]', p: 0.01 }, { text, p }, { text: '.', p }] }] })
const cfgOf = (confirm: 'auto' | 'always' | 'never') => readVoiceConfig(JSON.stringify({ voiceConfirm: confirm }), '/h')

interface Opts { rms?: string; rec?: number; stt?: number | 'throw'; json?: string }

function world(o: Opts = {}) {
  const runs: string[][] = []
  const out = { filled: [] as string[], submitted: [] as string[] }
  const $ = {
    ui: { status: () => {} },
    process: {
      run: async (argv: string[]) => {
        runs.push([...argv])
        if (argv[0] === 'rec') return { exitCode: o.rec ?? 0, stdout: '', stderr: '' }
        if (argv[0] === 'sox') return { exitCode: 0, stdout: '', stderr: `RMS     amplitude: ${o.rms ?? '0.050000'}\n` }
        if (o.stt === 'throw') throw new Error('timeout')
        return { exitCode: o.stt ?? 0, stdout: '', stderr: '' }
      },
    },
    fs: { read: async () => o.json ?? whisper(NE_TEXT, 0.9) },
    prompt: {
      fill: async (a: { text: string }) => (out.filled.push(a.text), { isFilled: true }),
      submit: async (a: { text: string }) => (out.submitted.push(a.text), { text: a.text }),
    },
  } as unknown as Engine
  return { $, runs, out }
}

test('records then transcribes then submits (never)', async () => {
  const w = world()
  const r = await ne(w.$, cfgOf('never'), WAV)
  expect(w.out.submitted).toEqual([NE_TEXT])
  expect(w.out.filled).toEqual([])
  expect(r.text).toContain('Submitted')
  expect(w.runs[0].slice(0, 6)).toEqual(['rec', '-q', '-r', '16000', '-c', '1'])
  expect(w.runs[2]).toEqual(['whisper-cli', '-l', 'ne', '-m', '/h/.cache/nepali-voice/models/ggml-large-v3-turbo-q5_0.bin', '-ojf', '-f', WAV])
})

test('always fills', async () => {
  const w = world()
  await ne(w.$, cfgOf('always'), WAV)
  expect(w.out.filled).toEqual([NE_TEXT])
  expect(w.out.submitted).toEqual([])
})

test('auto low confidence fills', async () => {
  const w = world({ json: whisper(NE_TEXT, 0.2) })
  await ne(w.$, cfgOf('auto'), WAV)
  expect(w.out.filled).toEqual([NE_TEXT])
  expect(w.out.submitted).toEqual([])
})

test('auto high confidence submits', async () => {
  const w = world()
  await ne(w.$, cfgOf('auto'), WAV)
  expect(w.out.submitted).toEqual([NE_TEXT])
  expect(w.out.filled).toEqual([])
})

test('auto empty or short transcript fills', () => {
  expect(needsConfirm({ text: '', confidence: 0.99 }, 'auto', 0.6)).toBe(true)
  expect(needsConfirm({ text: 'हो', confidence: 0.99 }, 'auto', 0.6)).toBe(true)
  expect(needsConfirm({ text: 'okay then', confidence: 0.99 }, 'auto', 0.6)).toBe(true)
  expect(needsConfirm({ text: NE_TEXT, confidence: 0.99 }, 'auto', 0.6)).toBe(false)
})

test('empty transcript submits nothing even under never', async () => {
  const w = world({ json: whisper('', 0.9) })
  const r = await ne(w.$, cfgOf('never'), WAV)
  expect(w.out.submitted).toEqual([])
  expect(w.out.filled).toEqual([])
  expect(r.text).toContain('No speech')
})

test('silent recording -> mic message, nothing submitted', async () => {
  const w = world({ rms: '0.000000' })
  const r = await ne(w.$, cfgOf('never'), WAV)
  expect(r.text).toContain('microphone permission')
  expect(w.out.submitted).toEqual([])
  expect(w.out.filled).toEqual([])
  expect(w.runs.some((a) => a[0] === 'whisper-cli')).toBe(false)
})

test('stt failure or timeout -> error, nothing submitted', async () => {
  for (const stt of [1, 'throw'] as const) {
    const w = world({ stt })
    const r = await ne(w.$, cfgOf('never'), WAV)
    expect(r.text).toContain('Transcription failed')
    expect(w.out.submitted).toEqual([])
    expect(w.out.filled).toEqual([])
  }
})

test('unreadable transcript json -> error, nothing submitted', async () => {
  const w = world({ json: 'not json' })
  const r = await ne(w.$, cfgOf('never'), WAV)
  expect(r.text).toContain('Could not read')
  expect(w.out.submitted).toEqual([])
})

test('parseWhisperJson confidence is mean token prob, specials skipped', () => {
  const t = parseWhisperJson(whisper(NE_TEXT, 0.8))
  expect(t.text).toBe(NE_TEXT)
  expect(Math.abs(t.confidence - 0.8) < 1e-9).toBe(true)
  expect(parseWhisperJson(JSON.stringify({ transcription: [{ text: 'x' }] })).confidence).toBe(0)
})

test('readVoiceConfig defaults when missing or malformed', () => {
  for (const j of [null, '', '{bad', '[]', '{"voiceConfirm":"x","threshold":9,"sttCommand":[1]}']) {
    const c = readVoiceConfig(j, '/h')
    expect(c.confirm).toBe('auto')
    expect(c.threshold).toBe(0.6)
    expect(c.sttCommand[0]).toBe('whisper-cli')
    expect(c.model).toBe('/h/.cache/nepali-voice/models/ggml-large-v3-turbo-q5_0.bin')
  }
})

test('readVoiceConfig reads nepali-voice.json keys', () => {
  const c = readVoiceConfig(JSON.stringify({ voiceConfirm: 'never', threshold: 0.4, model: '~/m.bin', sttCommand: ['stt', '{wav}'] }), '/h')
  expect(c).toEqual({ confirm: 'never', threshold: 0.4, model: '/h/m.bin', sttCommand: ['stt', '{wav}'] })
})
