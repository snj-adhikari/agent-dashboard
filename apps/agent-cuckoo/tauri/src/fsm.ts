export type Mode = 'hidden' | 'compact' | 'home';

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const HOME_CLOSE_MS = 15_000;
export const COMPACT_HIDE_MS = 180_000;
export const HOVER_GRACE_MS = 600;
export const FINISHED_PIN_MS = 5_200;

export interface FsmOptions {
  openOnHover: boolean;
  autoCloseMs: number;
  absenceMs: number;
}

export class IslandFsm {
  mode: Mode = 'compact';
  /** Voice listening is a flag over the current mode; timers pause while it is set. */
  listening = false;
  options: FsmOptions;
  private timer: unknown = null;
  private hovering = false;
  private openedByHover = false;
  private pinnedUntilFire = false;

  constructor(
    private timers: Timers,
    private isHeldOpen: () => boolean,
    private onChange: (from: Mode, to: Mode) => void = () => {},
    options: Partial<FsmOptions> = {},
  ) {
    this.options = { openOnHover: false, autoCloseMs: HOME_CLOSE_MS, absenceMs: COMPACT_HIDE_MS, ...options };
    this.arm();
  }

  hover(inside: boolean): void {
    this.hovering = inside;
    if (this.listening) {
      if (!(inside && this.options.openOnHover)) return;
      this.listening = false;
    }
    if (!inside) return this.arm();
    if (this.options.openOnHover && this.mode !== 'home') {
      this.go('home');
      this.openedByHover = true;
      return;
    }
    if (this.mode === 'hidden') this.go('compact');
    else if (!this.pinnedUntilFire) this.disarm();
  }

  click(): void {
    this.listening = false;
    this.openedByHover = false;
    this.go('home');
  }

  open(): void {
    this.click();
  }

  esc(): void {
    const wasListening = this.listening;
    this.listening = false;
    if (this.mode === 'home') this.go('compact');
    else if (wasListening) this.arm();
  }

  voiceWoke(): void {
    this.listening = true;
    this.disarm();
    if (this.mode === 'hidden') this.go('compact');
  }

  voiceFinished(): void {
    if (!this.listening) return;
    this.listening = false;
    this.arm();
  }

  alert(): void {
    this.click();
  }

  finished(): void {
    this.click();
    this.disarm();
    this.pinnedUntilFire = true;
    this.timer = this.timers.set(() => {
      this.timer = null;
      this.pinnedUntilFire = false;
      if (this.isHeldOpen() || this.hovering) this.arm();
      else this.go('compact');
    }, FINISHED_PIN_MS);
  }

  activity(): void {
    if (this.mode === 'hidden') this.go('compact');
    else if (this.mode === 'compact') this.arm();
  }

  reveal(): void {
    this.activity();
  }

  private go(to: Mode): void {
    const from = this.mode;
    this.mode = to;
    if (to !== 'home') this.openedByHover = false;
    this.pinnedUntilFire = false;
    this.arm();
    if (from !== to) this.onChange(from, to);
  }

  private disarm(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }

  private arm(): void {
    if (this.pinnedUntilFire) return;
    this.disarm();
    if (this.hovering || this.listening) return;
    if (this.mode === 'home') {
      this.timer = this.timers.set(() => {
        this.timer = null;
        if (this.isHeldOpen()) this.arm();
        else this.go('compact');
      }, this.openedByHover ? HOVER_GRACE_MS : this.options.autoCloseMs);
    } else if (this.mode === 'compact') {
      this.timer = this.timers.set(() => {
        this.timer = null;
        this.go('hidden');
      }, this.options.absenceMs);
    }
  }
}
