export type Sound = 'open' | 'close' | 'peek' | 'blip' | 'approval' | 'question' | 'finish' | 'error' | 'send' | 'pop' | 'gulp' | 'tick' | 'listen' | 'timer' | 'proud' | 'poke' | 'greeting';

export const DEFAULT_VOLUME = 0.12;
const POOL = 3;

const pools = new Map<Sound, HTMLAudioElement[]>();
let volume = DEFAULT_VOLUME;
let enabled = true;

export function configure(opts: { enabled?: boolean; volume?: number }): void {
  if (opts.enabled !== undefined) enabled = opts.enabled;
  if (opts.volume !== undefined) volume = Math.min(0.2, Math.max(0, opts.volume));
}

/** Plays a bundled sound from `public/sounds`, up to three overlapping copies per name; silent if the file is missing. */
export function play(name: Sound): void {
  if (!enabled || typeof Audio === 'undefined') return;
  let pool = pools.get(name);
  if (!pool) {
    pool = Array.from({ length: POOL }, () => {
      const a = new Audio(`sounds/${name}.wav`);
      a.preload = 'auto';
      return a;
    });
    pools.set(name, pool);
  }
  const a = pool.find((x) => x.paused || x.ended) ?? pool[0];
  a.volume = volume;
  a.currentTime = 0;
  void a.play().catch(() => {});
}
