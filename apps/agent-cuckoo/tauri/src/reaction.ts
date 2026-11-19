import type { Agent } from './types';

export type Reaction = 'working' | 'thinking' | 'waiting' | 'done' | 'error' | 'sleeping' | 'celebrating';
export type Pose =
  | 'working' | 'thinking' | 'waiting' | 'happy' | 'alarmed' | 'sleepy' | 'celebrate'
  | 'dance-a' | 'dance-b' | 'listening' | 'box' | 'dizzy' | 'proud' | 'surprised';

export const THINKING_MS = 10_000;
export const SLEEP_MS = 120_000;
export const DANCE_FRAME_MS = 400;
export const FIRST_BLINK_MS = [1_500, 3_500] as const;
export const BLINK_MS = [2_200, 5_400] as const;
export const BLINK_LISTENING_MS = [3_000, 4_500] as const;
export const DOUBLE_BLINK_P = 0.22;

export const POSE: Record<Reaction, Pose> = {
  working: 'working',
  thinking: 'thinking',
  waiting: 'waiting',
  done: 'happy',
  error: 'alarmed',
  sleeping: 'sleepy',
  celebrating: 'celebrate',
};

export interface ReactionContext { now: number; offline?: boolean; justFinished?: boolean }

export function reaction(agent: Pick<Agent, 'state' | 'lastActiveAt'> | null, ctx: ReactionContext): Reaction {
  if (ctx.offline) return 'error';
  if (!agent) return 'sleeping';
  const idle = agent.lastActiveAt == null ? Infinity : ctx.now - agent.lastActiveAt;
  switch (agent.state) {
    case 'waiting':
      return 'waiting';
    case 'working':
      return idle >= THINKING_MS && idle !== Infinity ? 'thinking' : 'working';
    case 'done':
      if (ctx.justFinished) return 'celebrating';
      return idle >= SLEEP_MS ? 'sleeping' : 'done';
    default:
      return 'sleeping';
  }
}

export const poseOf = (r: Reaction): Pose => POSE[r];
export const emojiOf = (r: Reaction): string => r;

const within = ([lo, hi]: readonly [number, number], r: number) => lo + r * (hi - lo);

/** `r` is a random number in [0, 1). */
export const firstBlinkMs = (r: number): number => within(FIRST_BLINK_MS, r);
export const blinkMs = (r: number, listening = false): number => within(listening ? BLINK_LISTENING_MS : BLINK_MS, r);
export const doubleBlink = (r: number): boolean => r < DOUBLE_BLINK_P;

/** Two-frame dance while music plays; frozen on the first frame under reduced motion. */
export function danceFrame(now: number, playing: boolean, reduced: boolean): Pose | null {
  if (!playing) return null;
  if (reduced) return 'dance-a';
  return Math.floor(now / DANCE_FRAME_MS) % 2 === 0 ? 'dance-a' : 'dance-b';
}
