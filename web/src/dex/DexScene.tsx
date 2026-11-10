import { useEffect, useState } from 'react'
import { hashOf } from '../../../src/shared/house'
import { shade } from './sprite'
import { GREY, Sprite } from './art'
import type { DexHouse } from './houses'
import type { HerdrAgent } from '../types'

const TW = 32
const TH = 16
const COLS = 3
const SPACING = 8
const YARD = 3.4
const WALKER = 20
const PERCHED = 14
const BALCONY_SLOTS = [-28, -14, 0, 14]
const DOOR_SLOTS = [-16, 10, -28]
const MAX_WALKERS = 8

const iso = (gx: number, gy: number): [number, number] => [((gx - gy) * TW) / 2, ((gx + gy) * TH) / 2]

const tile = (x: number, y: number): string => `M${x} ${y} l${TW / 2} ${TH / 2} l${-TW / 2} ${TH / 2} l${-TW / 2} ${-TH / 2} Z`

const diamond = (x: number, y: number, r: number): string => `M${x} ${y - (r * TH) / 2} L${x + (r * TW) / 2} ${y} L${x} ${y + (r * TH) / 2} L${x - (r * TW) / 2} ${y} Z`

const label = (a: HerdrAgent): string => a.codename || a.name || a.paneId

function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)'
  const [reduce, setReduce] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const on = (): void => setReduce(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return reduce
}

interface Placed {
  agent: HerdrAgent
  onFocus: (agent: HerdrAgent) => void
}

function Creature({ agent, onFocus, x, y, size, motion }: Placed & { x: number; y: number; size: number; motion?: string }) {
  return (
    <g transform={`translate(${x - size / 2} ${y - size})`} className="cursor-pointer" onClick={() => onFocus(agent)}>
      <title>{`${label(agent)}: ${agent.status}`}</title>
      <g className={motion}>
        <Sprite codename={label(agent)} colour={agent.colour || GREY} size={size} />
      </g>
    </g>
  )
}

/** Patrols an arc through the yard in front of the house, out and back, so it never walks behind the walls. */
function Walker({ agent, onFocus, x, y, slot, reduce }: Placed & { x: number; y: number; slot: number; reduce: boolean }) {
  const seed = hashOf(label(agent))
  const r = 36 + (slot % 4) * 6
  const dip = 12 + (slot % 3) * 5
  const path = `M${x - r} ${y - 2} Q${x} ${y + dip * 2} ${x + r} ${y - 2}`
  const dur = 7 + (seed % 6)
  const start = (seed % 100) / 100
  if (reduce) {
    const t = 0.15 + ((slot * 0.37) % 0.7)
    const sx = (1 - t) ** 2 * (x - r) + 2 * (1 - t) * t * x + t ** 2 * (x + r)
    const sy = (1 - t) ** 2 * (y - 2) + 2 * (1 - t) * t * (y + dip * 2) + t ** 2 * (y - 2)
    return <Creature agent={agent} onFocus={onFocus} x={sx} y={sy} size={WALKER} />
  }
  return (
    <g className="cursor-pointer" onClick={() => onFocus(agent)}>
      <title>{`${label(agent)}: ${agent.status}`}</title>
      <g>
        <animateMotion path={path} dur={`${dur}s`} begin={`-${(start * dur).toFixed(2)}s`} repeatCount="indefinite" keyPoints="0;1;0" keyTimes="0;0.5;1" calcMode="linear" />
        <g transform={`translate(${-WALKER / 2} ${-WALKER})`} className={agent.status === 'working' ? 'dex-bob' : undefined}>
          <Sprite codename={label(agent)} colour={agent.colour || GREY} size={WALKER} />
        </g>
      </g>
    </g>
  )
}

function Manor({ h, x, y, onFocus, reduce }: { h: DexHouse; x: number; y: number; onFocus: (agent: HerdrAgent) => void; reduce: boolean }) {
  const [c1, c2] = h.colours
  const dark = shade(c1, -0.3)
  const busy = h.creatures.some((a) => a.status === 'working')
  const lit = busy ? '#fde68a' : '#0b0f19'
  const blocked = h.creatures.filter((a) => a.status === 'blocked')
  const resting = h.creatures.filter((a) => a.status === 'idle' || a.status === 'done')
  const perched = resting.slice(0, BALCONY_SLOTS.length)
  const atDoor = blocked.slice(0, DOOR_SLOTS.length)
  const walkers = h.creatures.filter((a) => !perched.includes(a) && !atDoor.includes(a)).slice(0, MAX_WALKERS)
  const deck = y - 40
  const towerTop = deck - 30

  return (
    <g>
      <path d={diamond(x, y + 4, YARD)} fill={shade(c1, -0.65)} opacity={0.55} stroke="#78350f" strokeWidth={1.5} strokeDasharray="2 3" />
      <g className="cursor-pointer" onClick={() => h.warden && onFocus(h.warden)}>
        <title>{h.house}</title>
        <rect x={x - 26} y={deck} width={52} height={50} fill={c1} stroke="#0b0f19" />
        <rect x={x} y={deck} width={26} height={50} fill={dark} />
        {[-20, -8, 6, 18].map((dx) => <rect key={dx} x={x + dx - 3} y={deck + 10} width={6} height={8} fill={lit} stroke="#0b0f19" strokeWidth={0.5} />)}
        <rect x={x - 5} y={y - 2} width={10} height={12} fill="#0b0f19" />
        <rect x={x - 8} y={deck - 30} width={16} height={30} fill={dark} stroke="#0b0f19" />
        <rect x={x - 3} y={deck - 24} width={6} height={7} fill={h.warden ? '#fde68a' : '#0b0f19'} />
        <path d={`M${x - 10} ${towerTop} L${x} ${towerTop - 16} L${x + 10} ${towerTop} Z`} fill={c2} stroke="#0b0f19" />
        <path d={`M${x} ${towerTop - 16} V${towerTop - 28} H${x + 10} L${x + 7} ${towerTop - 25} L${x + 10} ${towerTop - 22} H${x}`} fill={c2} stroke="#0b0f19" strokeWidth={0.6} />
        <rect x={x - 28} y={deck - 2} width={56} height={3} fill={shade(c2, -0.2)} stroke="#0b0f19" strokeWidth={0.5} />
        <line x1={x - 28} y1={deck - 9} x2={x + 28} y2={deck - 9} stroke="#0b0f19" strokeWidth={1} />
        {Array.from({ length: 9 }, (_, i) => x - 28 + i * 7).map((px) => <line key={px} x1={px} y1={deck - 9} x2={px} y2={deck - 2} stroke="#0b0f19" strokeWidth={0.8} />)}
      </g>
      {h.warden && <Creature agent={h.warden} onFocus={onFocus} x={x} y={deck - 15} size={12} />}
      {perched.map((a, j) => <Creature key={a.paneId} agent={a} onFocus={onFocus} x={x + BALCONY_SLOTS[j] + PERCHED / 2} y={deck - 2} size={PERCHED} motion={reduce ? undefined : 'dex-bob'} />)}
      {atDoor.map((a, j) => <Creature key={a.paneId} agent={a} onFocus={onFocus} x={x + DOOR_SLOTS[j] + 3} y={y + 14} size={WALKER} motion="dex-flash" />)}
      {walkers.map((a, j) => <Walker key={a.paneId} agent={a} onFocus={onFocus} x={x} y={y + 6} slot={j} reduce={reduce} />)}
    </g>
  )
}

interface Props {
  houses: DexHouse[]
  onFocus: (agent: HerdrAgent) => void
}

export function DexScene({ houses, onFocus }: Props) {
  const reduce = useReducedMotion()
  const rows = Math.max(1, Math.ceil(houses.length / COLS))
  const span = Math.min(COLS, Math.max(1, houses.length))
  const groundW = span * SPACING
  const groundH = rows * SPACING
  const tiles: [number, number][] = []
  for (let gy = -1; gy < groundH; gy++) for (let gx = -1; gx < groundW; gx++) tiles.push([gx, gy])
  const left = iso(-1, groundH)[0] - TW / 2
  const right = iso(groundW, -1)[0] + TW / 2
  const top = iso(-1, -1)[1] - 70
  const bottom = iso(groundW, groundH)[1] + TH

  return (
    <svg viewBox={`${left} ${top} ${right - left} ${bottom - top}`} className="w-full max-h-[560px]" style={{ imageRendering: 'pixelated' }} role="img" aria-label="Map of houses and their creatures">
      {tiles.map(([gx, gy]) => {
        const [x, y] = iso(gx, gy)
        return <path key={`${gx},${gy}`} d={tile(x, y)} fill={(gx + gy) % 2 ? '#14532d' : '#166534'} stroke="#0b0f19" strokeWidth={0.5} />
      })}
      {houses.map((h, i) => {
        const [x, y] = iso((i % COLS) * SPACING + SPACING / 2, Math.floor(i / COLS) * SPACING + SPACING / 2)
        return <Manor key={h.session} h={h} x={x} y={y} onFocus={onFocus} reduce={reduce} />
      })}
    </svg>
  )
}
