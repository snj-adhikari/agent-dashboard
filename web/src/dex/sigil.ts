import { pick, rngOf } from '../../../src/shared/house'

/** Banner art on a 60x80 viewBox: the field split, then one charge glyph near the centre. */
export interface Sigil {
  division: string
  charge: string
}

const DIVISIONS = [
  '',
  'M0 34 L30 18 L60 34 L60 46 L30 30 L0 46 Z',
  'M0 0 H30 V70 H0 Z',
  'M0 40 Q10 34 20 40 T40 40 T60 40 V48 Q50 42 40 48 T20 48 T0 48 Z',
  'M0 0 H60 V18 H0 Z',
  'M0 0 L60 70 H40 L0 24 Z'
] as const

const CHARGES = [
  'M30 22 L34 33 L46 33 L36 40 L40 52 L30 45 L20 52 L24 40 L14 33 L26 33 Z',
  'M20 52 V30 H23 V26 H27 V30 H33 V26 H37 V30 H40 V52 Z M27 52 V44 H33 V52 Z',
  'M14 46 L22 32 L30 40 L38 32 L46 46 Z M22 32 L20 26 L25 30 Z M38 32 L40 26 L35 30 Z',
  'M30 24 L42 37 L30 50 L18 37 Z',
  'M36 24 A13 13 0 1 0 36 50 A10 10 0 1 1 36 24 Z',
  'M18 26 H42 L38 34 H34 V50 H26 V34 H22 Z',
  'M30 22 L33 34 L45 37 L33 40 L30 52 L27 40 L15 37 L27 34 Z'
] as const

export function sigilOf(seed: number): Sigil {
  const rand = rngOf(seed ^ 0x5eed)
  return { division: pick(rand, DIVISIONS), charge: pick(rand, CHARGES) }
}

export const BANNER_PATH = 'M2 2 H58 V70 L30 78 L2 70 Z'
