export const SIZE = 120;
export const BODY_RADIUS = 0.24 * SIZE;
export const POKES_FOR_DIZZY = 3;
export const POKE_WINDOW_MS = 1_700;
export const DIZZY_MS = 3_300;
export const SURPRISE_MS = 450;
export const FLY_MS = 450;
export const RETURN_DELAY_MS = 600;
export const LAND_MS = 250;
export const SLEEP_AFTER_MS = 120_000;
export const SLEEP_POINTER_PT = 150;
export const FPS_ACTIVE = 30;
export const FPS_ASLEEP = 10;

export type PokeResult = 'poke' | 'dizzy' | 'ignored';
export type Place = 'desktop' | 'island';

/** Persisted between launches. */
export interface DesktopPosition { x: number; y: number; onDesktop: boolean }

export interface Screen { x: number; y: number; w: number; h: number }

/** Saved position clamped onto the visible screen; default bottom-right. */
export function restorePosition(saved: DesktopPosition | null, screen: Screen): DesktopPosition {
  const maxX = screen.x + screen.w - SIZE;
  const maxY = screen.y + screen.h - SIZE;
  if (!saved) return { x: maxX, y: maxY, onDesktop: false };
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  return { x: clamp(saved.x, screen.x, maxX), y: clamp(saved.y, screen.y, maxY), onDesktop: saved.onDesktop };
}

/** Click-through everywhere but the rounded body. */
export function hitBody(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x > SIZE || y > SIZE) return false;
  const r = BODY_RADIUS;
  const cx = Math.min(Math.max(x, r), SIZE - r);
  const cy = Math.min(Math.max(y, r), SIZE - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

export class DesktopMascotLogic {
  private pokes: number[] = [];
  private dizzyUntil = -Infinity;
  private pending = false;
  private clearedAt = -Infinity;
  private alertAt = -Infinity;
  private lastActivity: number;

  constructor(private now: () => number) {
    this.lastActivity = now();
  }

  /** Single click (after the double-click interval has passed). */
  poke(): PokeResult {
    const t = this.now();
    this.activity();
    if (this.dizzy) return 'ignored';
    this.pokes = [...this.pokes.filter((p) => t - p < POKE_WINDOW_MS), t];
    if (this.pokes.length < POKES_FOR_DIZZY) return 'poke';
    this.pokes = [];
    this.dizzyUntil = t + DIZZY_MS;
    return 'dizzy';
  }

  get dizzy(): boolean {
    return this.now() < this.dizzyUntil;
  }

  /** Feed whether an approval or question is waiting. */
  alerts(pending: boolean): void {
    const t = this.now();
    if (pending && !this.pending) this.alertAt = t;
    if (!pending && this.pending) this.clearedAt = t;
    if (pending) this.activity();
    this.pending = pending;
  }

  /** Surprised for 0.45 s before flying to the island. */
  get surprised(): boolean {
    return this.pending && this.now() - this.alertAt < SURPRISE_MS;
  }

  place(): Place {
    if (this.pending) return this.surprised ? 'desktop' : 'island';
    return this.now() - this.clearedAt < RETURN_DELAY_MS ? 'island' : 'desktop';
  }

  activity(): void {
    this.lastActivity = this.now();
  }

  asleep(pointerDistance: number): boolean {
    return this.now() - this.lastActivity >= SLEEP_AFTER_MS && pointerDistance > SLEEP_POINTER_PT;
  }

  fps(pointerDistance: number): number {
    return this.asleep(pointerDistance) ? FPS_ASLEEP : FPS_ACTIVE;
  }
}
