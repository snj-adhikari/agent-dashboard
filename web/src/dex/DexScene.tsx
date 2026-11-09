import { shade } from './sprite'
import { GREY, Sprite } from './art'
import type { DexHouse } from './houses'
import type { HerdrAgent } from '../types'

const TW = 32
const TH = 16
const COLS = 3
const SPACING = 5

const iso = (gx: number, gy: number): [number, number] => [((gx - gy) * TW) / 2, ((gx + gy) * TH) / 2]

const tile = (x: number, y: number): string => `M${x} ${y} l${TW / 2} ${TH / 2} l${-TW / 2} ${TH / 2} l${-TW / 2} ${-TH / 2} Z`

const CREATURE_SPOTS: [number, number][] = [[1.4, 0], [0, 1.4], [1.4, 1.4], [-1.2, 0.4], [0.4, -1.2], [2.4, 0.6], [0.6, 2.4], [2.2, 2]]

interface Props {
  houses: DexHouse[]
  onFocus: (agent: HerdrAgent) => void
}

export function DexScene({ houses, onFocus }: Props) {
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
    <svg viewBox={`${left} ${top} ${right - left} ${bottom - top}`} className="w-full max-h-[420px]" style={{ imageRendering: 'pixelated' }} role="img" aria-label="Map of houses and their creatures">
      {tiles.map(([gx, gy]) => {
        const [x, y] = iso(gx, gy)
        return <path key={`${gx},${gy}`} d={tile(x, y)} fill={(gx + gy) % 2 ? '#14532d' : '#166534'} stroke="#0b0f19" strokeWidth={0.5} />
      })}
      {houses.map((h, i) => {
        const gx = (i % COLS) * SPACING + 1
        const gy = Math.floor(i / COLS) * SPACING + 1
        const [x, y] = iso(gx, gy)
        const [c1, c2] = h.colours
        return (
          <g key={h.session}>
            <path d={tile(x, y)} fill={shade(c1, -0.5)} stroke="#0b0f19" />
            <g className="cursor-pointer" onClick={() => h.warden && onFocus(h.warden)}>
              <title>{h.house}</title>
              <rect x={x - 9} y={y - 22} width={18} height={32} fill={c1} stroke="#0b0f19" />
              <rect x={x} y={y - 22} width={9} height={32} fill={shade(c1, -0.3)} />
              {[-9, -3, 3].map((dx) => <rect key={dx} x={x + dx} y={y - 27} width={6} height={5} fill={c1} stroke="#0b0f19" />)}
              <path d={`M${x - 10} ${y - 27} L${x} ${y - 46} L${x + 10} ${y - 27} Z`} fill={c2} stroke="#0b0f19" />
              <rect x={x - 3} y={y + 1} width={6} height={9} fill="#0b0f19" />
              <path d={`M${x} ${y - 46} V${y - 58} H${x + 9} L${x + 6} ${y - 55} L${x + 9} ${y - 52} H${x}`} fill={c2} stroke="#0b0f19" strokeWidth={0.6} />
            </g>
            {h.creatures.slice(0, CREATURE_SPOTS.length).map((a, j) => {
              const [cx, cy] = iso(gx + CREATURE_SPOTS[j][0], gy + CREATURE_SPOTS[j][1])
              const motion = a.status === 'working' ? 'dex-bob' : a.status === 'blocked' ? 'dex-flash' : ''
              return (
                <g key={a.paneId} transform={`translate(${cx - 8} ${cy - 2})`} className="cursor-pointer" onClick={() => onFocus(a)}>
                  <title>{`${a.codename || a.name || a.paneId}: ${a.status}`}</title>
                  <g className={motion}>
                    <Sprite codename={a.codename || a.name || a.paneId} colour={a.colour || GREY} size={16} />
                  </g>
                </g>
              )
            })}
          </g>
        )
      })}
    </svg>
  )
}
