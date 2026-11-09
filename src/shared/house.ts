/** Pure, dependency-free generators shared by the server (houses.json) and the web /dex page. */

export function hashOf(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Seeded PRNG (mulberry32); returns floats in [0, 1). */
export function rngOf(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const pick = <T>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length)]

const ONSETS = ['V', 'Th', 'K', 'Br', 'S', 'Dr', 'M', 'Qu', 'L', 'Gr', 'Z', 'Fen', 'Ash', 'Hal', 'Tr', 'Cal']
const NUCLEI = ['a', 'e', 'i', 'o', 'u', 'ae', 'y', 'ou']
const CODAS = ['rn', 'th', 'sk', 'll', 'nd', 'x', 'rr', 'v', 'mb', 'sh', 'lt', 'n']

export const MOTTOS = [
  'We ship at dawn',
  'Green builds or none',
  'The diff is short, the night is long',
  'No merge without review',
  'From red to green we rise',
  'Our tests stand watch',
  'Small commits, steady hands',
  'We read the logs so others sleep',
  'Rebase nothing, regret nothing',
  'Every ticket finds its end',
  'Lint clean, conscience clean',
  'The pipeline remembers',
  'We hold the main line',
  'Deploy with care, rollback with grace',
  'Fewer lines, firmer walls',
  'Our branches bear fruit'
] as const

export const HOUSE_COLOURS = ['#b91c1c', '#c2410c', '#ca8a04', '#15803d', '#0f766e', '#0369a1', '#4338ca', '#7e22ce', '#be185d', '#e2e8f0', '#1e293b', '#a16207'] as const

export interface House {
  seed: number
  house: string
  motto: string
  colours: [string, string]
}

const titleCase = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()

/** Deterministic house for a cmux workspace title, e.g. "House Varn of Grille". */
export function houseOf(title: string): House {
  const seed = hashOf(title.trim().toLowerCase())
  const rand = rngOf(seed)
  const name = pick(rand, ONSETS) + pick(rand, NUCLEI) + pick(rand, CODAS)
  const seat = (title.match(/[A-Za-z0-9][A-Za-z0-9-]*/g) || ['Nowhere']).slice(0, 2).map(titleCase).join(' and ')
  const c1 = Math.floor(rand() * HOUSE_COLOURS.length)
  const c2 = (c1 + 1 + Math.floor(rand() * (HOUSE_COLOURS.length - 1))) % HOUSE_COLOURS.length
  return { seed, house: `House ${name} of ${seat}`, motto: pick(rand, MOTTOS), colours: [HOUSE_COLOURS[c1], HOUSE_COLOURS[c2]] }
}

export const isWarden = (name?: string): boolean => !!name && name.startsWith('main-')
