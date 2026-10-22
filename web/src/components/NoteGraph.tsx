import { useEffect, useMemo, useRef, useState } from 'react'
import { trackedFetch as fetch } from '../progress'
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, type SimulationNodeDatum } from 'd3-force'

interface GraphNode extends SimulationNodeDatum {
  id: string
  label: string
  relPath: string
}

interface GraphLink {
  source: string | GraphNode
  target: string | GraphNode
}

const WIDTH = 1600
const HEIGHT = 900
const PADDING = 60
const REVEAL_BATCH = 2
const REVEAL_INTERVAL_MS = 300
const COLOR_CHANGE_MS = 4000

function fitView(nodes: GraphNode[]) {
  const xs = nodes.map((n) => n.x ?? WIDTH / 2)
  const ys = nodes.map((n) => n.y ?? HEIGHT / 2)
  const minX = Math.min(...xs) - PADDING
  const maxX = Math.max(...xs) + PADDING
  const minY = Math.min(...ys) - PADDING
  const maxY = Math.max(...ys) + PADDING
  const w = Math.max(200, maxX - minX)
  const h = Math.max(200, maxY - minY)
  return { x: minX, y: minY, w, h }
}

function idKey(v: string | GraphNode) {
  return typeof v === 'string' ? v : v.id
}

export function NoteGraph({ onSelect, expanded }: { onSelect: (relPath: string) => void; expanded?: boolean }) {
  const allNodesRef = useRef<GraphNode[]>([])
  const allLinksRef = useRef<GraphLink[]>([])
  const [revealCount, setRevealCount] = useState(0)
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [links, setLinks] = useState<GraphLink[]>([])
  const [nodeHues, setNodeHues] = useState<Record<string, number>>({})
  const [, setTick] = useState(0)

  const [view, setView] = useState({ x: 0, y: 0, w: WIDTH, h: HEIGHT })
  const autoFitRef = useRef(true)
  const dragRef = useRef<{ startX: number; startY: number; viewX: number; viewY: number } | null>(null)

  const degree = useMemo(() => {
    const d = new Map<string, number>()
    for (const l of links) {
      const s = idKey(l.source)
      const t = idKey(l.target)
      d.set(s, (d.get(s) || 0) + 1)
      d.set(t, (d.get(t) || 0) + 1)
    }
    return d
  }, [links])

  useEffect(() => {
    fetch('/api/vault/graph')
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok || !j.nodes.length) return
        allNodesRef.current = j.nodes.map((n: GraphNode) => ({ ...n }))
        allLinksRef.current = j.links
        setRevealCount(1)
      })
  }, [])

  useEffect(() => {
    if (!revealCount || revealCount >= allNodesRef.current.length) return
    const timer = setInterval(() => {
      setRevealCount((c) => Math.min(c + REVEAL_BATCH, allNodesRef.current.length))
    }, REVEAL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [revealCount])

  useEffect(() => {
    if (!revealCount) return
    const visibleNodes = allNodesRef.current.slice(0, revealCount)
    const visibleIds = new Set(visibleNodes.map((n) => n.id))
    const visibleLinks = allLinksRef.current.filter((l) => visibleIds.has(idKey(l.source)) && visibleIds.has(idKey(l.target)))
    setNodes(visibleNodes)
    setLinks(visibleLinks)
    setNodeHues((prev) => {
      const next = { ...prev }
      for (const n of visibleNodes) if (!(n.id in next)) next[n.id] = Math.random() * 360
      return next
    })
  }, [revealCount])

  useEffect(() => {
    if (!nodes.length) return
    const sim = forceSimulation(nodes)
      .force(
        'link',
        forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance(45)
      )
      .force('charge', forceManyBody().strength(-60))
      .force('center', forceCenter(WIDTH / 2, HEIGHT / 2))
      .force('collide', forceCollide(14))
      .alphaDecay(0.03)
      .alphaMin(0.001)

    sim.on('tick', () => {
      setTick((t) => t + 1)
      if (autoFitRef.current) setView(fitView(nodes))
    })

    const driftTimer = setInterval(() => {
      sim.alpha(0.02).restart()
    }, 6000)

    return () => {
      sim.stop()
      clearInterval(driftTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes])

  useEffect(() => {
    const colorTimer = setInterval(() => {
      setNodeHues((prev) => {
        const next = { ...prev }
        for (const id of Object.keys(next)) next[id] = Math.random() * 360
        return next
      })
    }, COLOR_CHANGE_MS)
    return () => clearInterval(colorTimer)
  }, [])

  function zoomBy(factor: number) {
    autoFitRef.current = false
    setView((v) => {
      const w = Math.max(200, Math.min(WIDTH * 3, v.w * factor))
      const h = w * (v.h / v.w)
      return { x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2, w, h }
    })
  }

  function onWheel(e: React.WheelEvent<SVGSVGElement>) {
    e.preventDefault()
    zoomBy(e.deltaY > 0 ? 1.1 : 0.9)
  }

  function onMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    autoFitRef.current = false
    dragRef.current = { startX: e.clientX, startY: e.clientY, viewX: view.x, viewY: view.y }
  }

  function onMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const drag = dragRef.current
    if (!drag) return
    const dx = ((e.clientX - drag.startX) / (expanded ? 1400 : 600)) * view.w
    const dy = ((e.clientY - drag.startY) / (expanded ? 800 : 260)) * view.h
    setView((v) => ({ ...v, x: drag.viewX - dx, y: drag.viewY - dy }))
  }

  function endDrag() {
    dragRef.current = null
  }

  function resetView() {
    autoFitRef.current = true
    setView(fitView(nodes))
  }

  if (!nodes.length) return null

  return (
    <div className={expanded ? 'relative left-1/2 right-1/2 -mx-[50vw] w-screen px-6' : 'relative rounded-2xl mb-6 overflow-hidden'}>
      <div className="graph-3d-scene overflow-hidden">
        <div className="graph-3d-inner">
          <svg
            viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
            className={`w-full ${expanded ? 'h-[1100px]' : 'h-64'} cursor-grab active:cursor-grabbing`}
            onWheel={onWheel}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={endDrag}
            onMouseLeave={endDrag}
          >
            <defs>
              {nodes.map((n) => {
                const h = nodeHues[n.id] ?? 200
                return (
                  <radialGradient key={n.id} id={`sphere-${n.id}`} cx="35%" cy="30%" r="70%">
                    <stop offset="0%" stopColor={`hsl(${h}, 85%, 78%)`} />
                    <stop offset="60%" stopColor={`hsl(${h}, 75%, 55%)`} />
                    <stop offset="100%" stopColor={`hsl(${h}, 70%, 35%)`} />
                  </radialGradient>
                )
              })}
            </defs>
            {links.map((l, i) => {
              const s = l.source as GraphNode
              const t = l.target as GraphNode
              if (typeof s !== 'object' || typeof t !== 'object' || s.x == null || t.x == null) return null
              return <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke="#94a3b8" strokeWidth={1} opacity={0.5} />
            })}
            {nodes.map((n) => {
              const conn = degree.get(n.id) || 0
              const radius = 6 + Math.min(conn, 10) * 0.7
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x || 0},${n.y || 0})`}
                  className="cursor-pointer"
                  onClick={() => onSelect(n.relPath)}
                >
                  <circle
                    r={radius}
                    fill={`url(#sphere-${n.id})`}
                    stroke="#cbd5e1"
                    strokeWidth={0.75}
                    className="transition-all duration-[3000ms]"
                  />
                  <text x={radius + 4} y={3} fontSize={9} fill="#e2e8f0">
                    {n.label}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>
      </div>

      {expanded && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-20 flex gap-1">
          <button
            onClick={() => zoomBy(0.8)}
            className="rounded-md bg-slate-800/95 border border-slate-700 w-8 h-8 flex items-center justify-center text-slate-200 hover:bg-slate-700 shadow-lg"
          >
            +
          </button>
          <button
            onClick={() => zoomBy(1.25)}
            className="rounded-md bg-slate-800/95 border border-slate-700 w-8 h-8 flex items-center justify-center text-slate-200 hover:bg-slate-700 shadow-lg"
          >
            −
          </button>
          <button
            onClick={resetView}
            className="rounded-md bg-slate-800/95 border border-slate-700 px-3 h-8 text-xs text-slate-200 hover:bg-slate-700 shadow-lg"
          >
            Fit to view
          </button>
        </div>
      )}

      {!expanded && (
        <div className="absolute top-4 right-4 z-10 flex gap-1">
          <button
            onClick={() => zoomBy(0.8)}
            className="rounded-md bg-slate-800/90 border border-slate-700 w-6 h-6 flex items-center justify-center text-slate-300 hover:bg-slate-700"
          >
            +
          </button>
          <button
            onClick={() => zoomBy(1.25)}
            className="rounded-md bg-slate-800/90 border border-slate-700 w-6 h-6 flex items-center justify-center text-slate-300 hover:bg-slate-700"
          >
            −
          </button>
          <button
            onClick={resetView}
            className="rounded-md bg-slate-800/90 border border-slate-700 px-2 h-6 text-[10px] text-slate-300 hover:bg-slate-700"
          >
            Fit to view
          </button>
        </div>
      )}
    </div>
  )
}
