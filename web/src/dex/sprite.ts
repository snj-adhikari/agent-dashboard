import { hashOf, pick, rngOf } from '../../../src/shared/house'

export const SPRITE_SIZE = 16
const HALF = SPRITE_SIZE / 2

/** Cell values: 0 empty, 1 outline, 2 body, 3 belly shade, 4 eye, 5 accent (horns, ears, fins). */
export type SpriteGrid = number[][]

const FEATURES = ['horns', 'ears', 'antennae', 'fins', 'crest'] as const

/** Deterministic, left-right symmetric 16x16 creature for a codename. */
export function spriteOf(codename: string): SpriteGrid {
  const rand = rngOf(hashOf(codename))
  const grid: SpriteGrid = Array.from({ length: SPRITE_SIZE }, () => new Array<number>(SPRITE_SIZE).fill(0))
  const set = (x: number, y: number, v: number): void => {
    if (x < 0 || x >= HALF || y < 0 || y >= SPRITE_SIZE) return
    grid[y][x] = v
    grid[y][SPRITE_SIZE - 1 - x] = v
  }
  const rx = 3.5 + rand() * 3
  const ry = 4 + rand() * 2.5
  const cy = 9 + rand()
  for (let y = 0; y < SPRITE_SIZE - 1; y++) {
    for (let x = 1; x < HALF; x++) {
      const dx = (x + 0.5 - HALF) / rx
      const dy = (y + 0.5 - cy) / ry
      const d = dx * dx + dy * dy
      if (d < 0.7 || (d < 1.15 && rand() < 0.45)) set(x, y, y > cy + 1.5 ? 3 : 2)
    }
  }
  const legX = HALF - 2 - Math.floor(rand() * 2)
  set(legX, SPRITE_SIZE - 2, 3)
  set(legX, SPRITE_SIZE - 1, 3)

  const top = grid.findIndex((row) => row.some((v) => v > 0))
  const feature = pick(rand, FEATURES)
  if (feature === 'horns') [[HALF - 3, top - 1], [HALF - 4, top - 2], [HALF - 4, top - 3]].forEach(([x, y]) => set(x, y, 5))
  if (feature === 'ears') [[HALF - 3, top - 1], [HALF - 2, top - 1], [HALF - 3, top - 2]].forEach(([x, y]) => set(x, y, 5))
  if (feature === 'antennae') [[HALF - 2, top - 1], [HALF - 2, top - 2], [HALF - 3, top - 3]].forEach(([x, y]) => set(x, y, 5))
  if (feature === 'crest') [[HALF - 1, top - 1], [HALF - 1, top - 2], [HALF - 2, top - 1]].forEach(([x, y]) => set(x, y, 5))
  if (feature === 'fins') {
    const side = grid[Math.round(cy)].findIndex((v) => v > 0)
    ;[[side - 1, Math.round(cy) - 1], [side - 1, Math.round(cy)], [side - 2, Math.round(cy) - 1]].forEach(([x, y]) => set(x, y, 5))
  }

  const ey = Math.max(top + 1, Math.round(cy - ry / 2))
  const ex = HALF - 2 - Math.floor(rand() * 2)
  set(ex, ey, 4)
  if (rand() < 0.4) set(ex, ey + 1, 4)

  const filled = grid.map((row) => row.map((v) => v > 0))
  for (let y = 0; y < SPRITE_SIZE; y++) {
    for (let x = 0; x < SPRITE_SIZE; x++) {
      if (filled[y][x]) continue
      const near = [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([ox, oy]) => filled[y + oy]?.[x + ox])
      if (near) grid[y][x] = 1
    }
  }
  return grid
}

/** Mixes a #rrggbb colour toward black (amount < 0) or white (amount > 0). */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const target = amount < 0 ? 0 : 255
  const mix = (c: number): number => Math.round(c + (target - c) * Math.abs(amount))
  const r = mix((n >> 16) & 255)
  const g = mix((n >> 8) & 255)
  const b = mix(n & 255)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

export function spritePalette(colour: string): string[] {
  return ['transparent', '#0b0f19', colour, shade(colour, -0.35), '#f8fafc', shade(colour, 0.45)]
}
