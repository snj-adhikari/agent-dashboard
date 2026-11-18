export type Cue = 'needs-you' | 'finished' | 'sent';

const NOTES: Record<Cue, number[]> = {
  'needs-you': [880, 660, 880],
  finished: [523, 659, 784],
  sent: [660],
};

let ctx: AudioContext | null = null;

export function play(cue: Cue): void {
  try {
    ctx ??= new AudioContext();
    const t0 = ctx.currentTime;
    NOTES[cue].forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      const start = t0 + i * 0.12;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.15, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.11);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(start);
      osc.stop(start + 0.12);
    });
  } catch {
    ctx = null;
  }
}
