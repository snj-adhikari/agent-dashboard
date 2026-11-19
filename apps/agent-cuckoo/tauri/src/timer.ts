export const WORK_MS = 25 * 60_000;
export const SHORT_BREAK_MS = 5 * 60_000;
export const LONG_BREAK_MS = 15 * 60_000;
export const LONG_BREAK_EVERY = 4;
export const TIMER_POSE = 'clock';

export type Phase = 'work' | 'short' | 'long';

/** Plain JSON so it survives a restart: a running phase stores its absolute end, a paused one its remaining time. */
export interface TimerState {
  phase: Phase;
  endsAt: number | null;
  pausedLeft: number | null;
  worksDone: number;
}

export const PHASE_MS: Record<Phase, number> = { work: WORK_MS, short: SHORT_BREAK_MS, long: LONG_BREAK_MS };

export const idle = (): TimerState => ({ phase: 'work', endsAt: null, pausedLeft: null, worksDone: 0 });

export const running = (s: TimerState): boolean => s.endsAt !== null;

export function remaining(s: TimerState, now: number): number {
  if (s.endsAt !== null) return Math.max(0, s.endsAt - now);
  return s.pausedLeft ?? PHASE_MS[s.phase];
}

export function start(s: TimerState, now: number): TimerState {
  if (s.endsAt !== null) return s;
  return { ...s, endsAt: now + (s.pausedLeft ?? PHASE_MS[s.phase]), pausedLeft: null };
}

export function pause(s: TimerState, now: number): TimerState {
  if (s.endsAt === null) return s;
  return { ...s, endsAt: null, pausedLeft: remaining(s, now) };
}

export const reset = (): TimerState => idle();

/** Advances past a finished phase; the next phase waits for `start`. `finished` drives the sound and reveal. */
export function tick(s: TimerState, now: number): { state: TimerState; finished: Phase | null } {
  if (s.endsAt === null || now < s.endsAt) return { state: s, finished: null };
  const worksDone = s.phase === 'work' ? s.worksDone + 1 : s.worksDone;
  const next: Phase = s.phase !== 'work' ? 'work' : worksDone % LONG_BREAK_EVERY === 0 ? 'long' : 'short';
  return { state: { phase: next, endsAt: null, pausedLeft: null, worksDone }, finished: s.phase };
}

export function countdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
