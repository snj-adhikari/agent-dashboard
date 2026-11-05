import type { EngineInterface as Engine } from 'claude-code'

export type VoiceConfirm = 'auto' | 'always' | 'never'
export interface VoiceConfig { confirm: VoiceConfirm; sttCommand: string[]; model: string; threshold: number }
export interface Transcript { text: string; confidence: number }

const MODEL = '~/.cache/nepali-voice/models/ggml-large-v3-turbo-q5_0.bin'
const STT = ['whisper-cli', '-l', 'ne', '-m', '{model}', '-ojf', '-f', '{wav}']
const SILENT_RMS = 0.0005
const MIC_MSG = 'No audio captured. Check microphone permission for your terminal (System Settings > Privacy & Security > Microphone).'

export function readVoiceConfig(configJson: string | null, home: string): VoiceConfig {
  let v: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(configJson ?? '')
    if (parsed && typeof parsed === 'object') v = parsed
  } catch {}
  const strs = (x: unknown) => Array.isArray(x) && x.length > 0 && x.every((s) => typeof s === 'string')
  const model = typeof v.model === 'string' && v.model ? v.model : MODEL
  return {
    confirm: v.voiceConfirm === 'always' || v.voiceConfirm === 'never' ? v.voiceConfirm : 'auto',
    sttCommand: strs(v.sttCommand) ? (v.sttCommand as string[]) : STT,
    model: model.replace(/^~(?=\/)/, home),
    threshold: typeof v.threshold === 'number' && v.threshold >= 0 && v.threshold <= 1 ? v.threshold : 0.6,
  }
}

export function parseWhisperJson(json: string): Transcript {
  const parsed = JSON.parse(json) as { transcription?: { text?: string; tokens?: { text?: string; p?: number }[] }[] }
  const segs = parsed.transcription ?? []
  const text = segs.map((s) => s.text ?? '').join('').trim()
  const ps = segs.flatMap((s) => s.tokens ?? []).filter((t) => !(t.text ?? '').startsWith('[_') && typeof t.p === 'number').map((t) => t.p as number)
  return { text, confidence: ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0 }
}

export function needsConfirm(t: Transcript, mode: VoiceConfirm, threshold: number): boolean {
  if (mode === 'always') return true
  if (mode === 'never') return false
  const devanagari = (t.text.match(/[ऀ-ॿ]/g) ?? []).length
  return t.confidence < threshold || t.text.trim().length < 4 || devanagari < 3
}

export async function ne($: Engine, cfg: VoiceConfig, wavPath: string): Promise<{ text: string }> {
  $.ui.status('Recording... speak now (stops after a pause, 60 s max)')
  const rec = await $.process.run(['rec', '-q', '-r', '16000', '-c', '1', '-b', '16', wavPath, 'silence', '1', '0.1', '3%', '1', '2.0', '3%'], { timeoutMs: 60_000 }).catch(() => null)
  if (!rec || rec.exitCode !== 0) return { text: 'Recording failed or no speech detected. Check that sox is installed and the microphone is allowed.' }

  const stat = await $.process.run(['sox', wavPath, '-n', 'stat'], { timeoutMs: 10_000 }).catch(() => null)
  const rms = Number(/RMS\s+amplitude:\s*([\d.eE+-]+)/.exec(`${stat?.stderr ?? ''}${stat?.stdout ?? ''}`)?.[1])
  if (!stat || !(rms >= SILENT_RMS)) return { text: MIC_MSG }

  $.ui.status('Transcribing...')
  const argv = cfg.sttCommand.map((a) => a.replace('{model}', cfg.model).replace('{wav}', wavPath))
  const stt = await $.process.run(argv, { timeoutMs: 120_000 }).catch(() => null)
  if (!stt || stt.exitCode !== 0) return { text: 'Transcription failed or timed out. Nothing submitted.' }

  let t: Transcript
  try {
    t = parseWhisperJson(await $.fs.read(`${wavPath}.json`))
  } catch {
    return { text: 'Could not read the transcript. Nothing submitted.' }
  }
  if (!t.text) return { text: 'No speech recognised. Nothing submitted.' }
  if (needsConfirm(t, cfg.confirm, cfg.threshold)) {
    await $.prompt.fill({ text: t.text })
    return { text: 'Transcript placed in the prompt box: edit if needed, then press Enter.' }
  }
  await $.prompt.submit({ text: t.text })
  return { text: 'Submitted transcript.' }
}
