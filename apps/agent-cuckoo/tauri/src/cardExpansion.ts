export const ISLAND_MAX_H = 520;
export const HEADER_H = 8 + 34;
export const ISLAND_PAD_H = 10;
export const CLAMP_LINES = 3;
const CHARS_PER_LINE = 64;

export interface IslandFit { base: number; content: number | null; collapsed: boolean; max: number }

/** Island height: header row only when collapsed, else the card's natural height clamped to [base, max]; content past max scrolls. */
export function islandHeight(f: IslandFit): number {
  if (f.collapsed) return HEADER_H + ISLAND_PAD_H;
  const top = Math.max(f.base, Math.min(f.max, ISLAND_MAX_H));
  if (f.content == null) return Math.min(f.base, top);
  return Math.round(Math.min(top, Math.max(f.base, HEADER_H + f.content + ISLAND_PAD_H)));
}

// ponytail: line count from a fixed chars-per-line estimate, measure the rendered box if fonts or widths vary a lot
export const isLong = (text: string, lines = CLAMP_LINES): boolean =>
  text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / CHARS_PER_LINE)), 0) > lines;

/** Per-card open state in memory, keyed by card id; ids that leave the screen are forgotten. */
export class CardExpansion {
  private open = new Map<string, boolean>();
  rev = 0;

  isOpen(id: string, fallback = false): boolean {
    return this.open.get(id) ?? fallback;
  }

  toggle(id: string, fallback = false): boolean {
    const next = !this.isOpen(id, fallback);
    this.open.set(id, next);
    this.rev++;
    return next;
  }

  prune(live: Iterable<string>): void {
    const keep = new Set(live);
    for (const id of [...this.open.keys()]) if (!keep.has(id)) this.open.delete(id);
  }
}

export const cards = new CardExpansion();
