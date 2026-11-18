export type Mode = 'hidden' | 'compact' | 'home';

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const HOME_CLOSE_MS = 15_000;
export const COMPACT_HIDE_MS = 180_000;

export class IslandFsm {
  mode: Mode = 'compact';
  private timer: unknown = null;

  constructor(
    private timers: Timers,
    private isHeldOpen: () => boolean,
    private onChange: (from: Mode, to: Mode) => void = () => {},
  ) {
    this.arm();
  }

  hover(inside: boolean): void {
    if (inside) this.go('home');
    else if (this.mode === 'home') this.arm();
  }

  activity(): void {
    if (this.mode === 'hidden') this.go('compact');
    else if (this.mode === 'compact') this.arm();
  }

  open(): void {
    this.go('home');
  }

  private go(to: Mode): void {
    const from = this.mode;
    this.mode = to;
    this.arm();
    if (from !== to) this.onChange(from, to);
  }

  private arm(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    if (this.mode === 'home') {
      this.timer = this.timers.set(() => {
        this.timer = null;
        if (this.isHeldOpen()) this.arm();
        else this.go('compact');
      }, HOME_CLOSE_MS);
    } else if (this.mode === 'compact') {
      this.timer = this.timers.set(() => {
        this.timer = null;
        this.go('hidden');
      }, COMPACT_HIDE_MS);
    }
  }
}
