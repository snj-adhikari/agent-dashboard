export const OUTFITS = [
  'none', 'party-hat', 'beanie', 'crown', 'witch-hat', 'santa-hat',
  'bunny-ears', 'bow', 'sunglasses', 'round-glasses', 'scarf', 'pumpkin',
] as const;
export type Outfit = (typeof OUTFITS)[number];
export type OutfitChoice = Outfit | 'auto';
export type Hemisphere = 'north' | 'south';

export const OUTFIT_TWEEN_MS = 350;
export const FRAME = 128;
export const HEAD_BOX = { x: 24, y: 0, w: 80, h: 72 } as const;
export const EYE_Y = 60;

/** Inclusive [month, day] ranges, month 1-12; a range whose start is after its end wraps the new year. */
type Range = readonly [readonly [number, number], readonly [number, number]];
const PARTY: Range = [[12, 31], [1, 2]];
const SANTA: Range = [[12, 1], [12, 26]];
const WITCH: Range = [[10, 1], [11, 1]];
export const SUMMER: Record<Hemisphere, Range> = { north: [[6, 21], [8, 31]], south: [[12, 1], [2, 29]] };
/** Bunny ears from Good Friday to Easter Monday. */
export const EASTER_FROM_DAYS = -2;
export const EASTER_TO_DAYS = 1;

const key = (m: number, d: number) => m * 100 + d;

function inRange(date: Date, [[m1, d1], [m2, d2]]: Range): boolean {
  const k = key(date.getMonth() + 1, date.getDate());
  const a = key(m1, d1);
  const b = key(m2, d2);
  return a <= b ? k >= a && k <= b : k >= a || k <= b;
}

/** Western (Gregorian) Easter Sunday, anonymous Gregorian algorithm. */
export function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function isEaster(date: Date): boolean {
  const sunday = easter(date.getFullYear());
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((day.getTime() - sunday.getTime()) / 86_400_000);
  return diff >= EASTER_FROM_DAYS && diff <= EASTER_TO_DAYS;
}

/** Seasonal pick in local time; holidays win over summer. */
export function seasonal(date: Date, hemisphere: Hemisphere = 'south'): Outfit {
  if (inRange(date, PARTY)) return 'party-hat';
  if (inRange(date, SANTA)) return 'santa-hat';
  if (inRange(date, WITCH)) return 'witch-hat';
  if (isEaster(date)) return 'bunny-ears';
  if (inRange(date, SUMMER[hemisphere])) return 'sunglasses';
  return 'none';
}

export function resolveOutfit(choice: OutfitChoice, date: Date, hemisphere: Hemisphere = 'south'): Outfit {
  return choice === 'auto' ? seasonal(date, hemisphere) : choice;
}

export type MascotKind = 'main' | 'mini' | 'desktop';
/** The main character wears the outfit on the island and on the desktop; pill and grid minis never do. */
export const wearsOutfit = (kind: MascotKind): boolean => kind !== 'mini';

export interface OutfitLayer { src: string; srcset: string; x: number; y: number; size: number }

/** Outfit art is drawn in the full 128 pose frame over the head box, so the layer sits at the frame origin and takes the pose's transform. */
export function outfitLayer(outfit: Outfit): OutfitLayer | null {
  if (outfit === 'none') return null;
  const base = `mascot/outfit-${outfit}`;
  return { src: `${base}.png`, srcset: `${base}.png 1x, ${base}@2x.png 2x`, x: 0, y: 0, size: FRAME };
}
