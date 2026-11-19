export const UPLOAD_VIEW_H = 176;
export const MORPH_MS = 380;
export const SWALLOW_MS = 360;
export const GULP_AT_MS = 330;
export const UPLOAD_MS = [1_200, 2_100] as const;
export const TICK_PCT = 10;
export const MORPH_SPRING = { response: 0.36, damping: 0.72 } as const;
export const UPLOAD_POSE = 'box';

export type UploadEvent =
  | { at: number; kind: 'morph' | 'swallow' | 'gulp' | 'upload' | 'choose' }
  | { at: number; kind: 'tick'; pct: number };

/** `r` in [0, 1) picks the upload length; `gulp` lands inside the swallow. */
export function uploadTimeline(r: number): UploadEvent[] {
  const uploadMs = UPLOAD_MS[0] + r * (UPLOAD_MS[1] - UPLOAD_MS[0]);
  const swallowAt = MORPH_MS;
  const uploadAt = swallowAt + SWALLOW_MS;
  const ticks: UploadEvent[] = [];
  for (let pct = TICK_PCT; pct <= 100; pct += TICK_PCT) ticks.push({ at: uploadAt + (uploadMs * pct) / 100, kind: 'tick', pct });
  return [
    { at: 0, kind: 'morph' },
    { at: swallowAt, kind: 'swallow' },
    { at: swallowAt + GULP_AT_MS, kind: 'gulp' },
    { at: uploadAt, kind: 'upload' },
    ...ticks,
    { at: uploadAt + uploadMs, kind: 'choose' },
  ];
}

export type UploadPhase = 'morph' | 'swallow' | 'upload' | 'choose';

/** Progress holds at 100% in `upload` until the real upload has finished. */
export function uploadPhaseAt(t: number, timeline: UploadEvent[], uploaded: boolean): UploadPhase {
  let phase: UploadPhase = 'morph';
  for (const e of timeline) {
    if (e.at > t) break;
    if (e.kind === 'morph' || e.kind === 'swallow' || e.kind === 'upload' || e.kind === 'choose') phase = e.kind;
  }
  return phase === 'choose' && !uploaded ? 'upload' : phase;
}

export function uploadPct(t: number, timeline: UploadEvent[]): number {
  let pct = 0;
  for (const e of timeline) if (e.kind === 'tick' && e.at <= t) pct = e.pct;
  return pct;
}
