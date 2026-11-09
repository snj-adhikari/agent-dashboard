import { useMemo } from 'react'
import { BANNER_PATH, sigilOf } from './sigil'
import { SPRITE_SIZE, spriteOf, spritePalette } from './sprite'

export const GREY = '#64748b'

interface SpriteProps {
  codename: string
  colour?: string
  size: number
}

export function Sprite({ codename, colour = GREY, size }: SpriteProps) {
  const grid = useMemo(() => spriteOf(codename), [codename])
  const palette = spritePalette(colour)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${SPRITE_SIZE} ${SPRITE_SIZE}`} shapeRendering="crispEdges" style={{ imageRendering: 'pixelated' }} aria-hidden>
      {grid.flatMap((row, y) => row.map((v, x) => (v ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={palette[v]} /> : null)))}
    </svg>
  )
}

interface BannerProps {
  seed: number
  colours: [string, string]
  width: number
}

export function Banner({ seed, colours: [c1, c2], width }: BannerProps) {
  const { division, charge } = sigilOf(seed)
  const clip = `banner-${seed}`
  return (
    <svg width={width} height={(width * 80) / 60} viewBox="0 0 60 80" aria-hidden>
      <clipPath id={clip}>
        <path d={BANNER_PATH} />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <rect width={60} height={80} fill={c1} />
        {division && <path d={division} fill={c2} opacity={0.55} />}
      </g>
      <path d={BANNER_PATH} fill="none" stroke={c2} strokeWidth={3} />
      <path d={charge} fill={c2} stroke="#0b0f19" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  )
}
