import { useCallback, useMemo, useState } from 'react'
import { api } from '../api'
import type { HerdrAgent } from '../types'
import { usePolling } from '../usePolling'
import { Banner, GREY, Sprite } from './art'
import { DexScene } from './DexScene'
import { dexNumber, housesOf, type DexHouse } from './houses'

const focusTarget = (a: HerdrAgent): string => a.name || (a.host === 'herdr-app' ? a.paneId : '')

const STATUS: Record<string, { label: string; className: string }> = {
  working: { label: 'On the hunt', className: 'bg-amber-500/20 text-amber-300 border-amber-500/50' },
  blocked: { label: 'Summoned!', className: 'bg-red-500/25 text-red-300 border-red-500/60 motion-safe:animate-pulse' },
  done: { label: 'Returned victorious', className: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50' },
  idle: { label: 'Resting', className: 'bg-slate-500/20 text-slate-300 border-slate-500/40' }
}
const UNKNOWN = { label: 'Wandering', className: 'bg-slate-700/30 text-slate-400 border-slate-600/40' }
const SPOILS_CAP = 20
const REALMS = [
  { host: 'herdr', title: 'cmux' },
  { host: 'herdr-app', title: 'Herdr app' }
] as const

const short = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const spriteKey = (a: HerdrAgent): string => a.codename || a.name || a.paneId

function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] || UNKNOWN
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${s.className}`}>{s.label}</span>
}

interface CardProps {
  agent: HerdrAgent
  house: string
  maxSpoils: number
  onFocus: (a: HerdrAgent) => void
}

function CreatureCard({ agent, house, maxSpoils, onFocus }: CardProps) {
  const colour = agent.colour || GREY
  const spoils = agent.changedFiles ?? 0
  return (
    <button
      type="button"
      onClick={() => onFocus(agent)}
      disabled={!focusTarget(agent)}
      className="group flex w-full flex-col gap-2 rounded-md border-2 bg-slate-900 p-3 text-left font-mono shadow-[4px_4px_0_#020617] transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 disabled:cursor-default"
      style={{ borderColor: colour }}
    >
      <div className="flex items-center justify-between text-[10px] text-slate-500">
        <span>{dexNumber(spriteKey(agent))}</span>
        <StatusBadge status={agent.status} />
      </div>
      <div className="flex items-center gap-3">
        <div className="shrink-0 rounded border border-slate-700 bg-slate-950 p-1" style={{ boxShadow: `inset 0 0 0 2px ${colour}33` }}>
          <Sprite codename={spriteKey(agent)} colour={colour} size={64} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-xl font-bold leading-tight" style={{ color: colour }}>
            {agent.codename || agent.name || agent.paneId}
          </div>
          <div className="truncate text-[11px] text-slate-500">sworn to {house}</div>
          {agent.ticket && <span className="mt-1 inline-block rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-300">{agent.ticket}</span>}
        </div>
      </div>
      <p className="min-h-[2.5em] text-xs text-slate-300" title={agent.title}>
        {short(agent.title || agent.tabTitle || 'No quest yet', 90)}
      </p>
      <div>
        <div className="mb-0.5 flex justify-between text-[10px] text-slate-400">
          <span>Spoils: {spoils} files</span>
        </div>
        <div className="h-2 overflow-hidden rounded-sm border border-slate-700 bg-slate-950">
          <div className="h-full" style={{ width: `${Math.min(100, (spoils / maxSpoils) * 100)}%`, background: colour }} />
        </div>
      </div>
      {agent.branch && <div className="truncate text-[10px] text-slate-600">⎇ {agent.branch}</div>}
    </button>
  )
}

function HouseSection({ house, maxSpoils, onFocus }: { house: DexHouse; maxSpoils: number; onFocus: (a: HerdrAgent) => void }) {
  const [c1, c2] = house.colours
  const warden = house.warden
  return (
    <section className="rounded-lg border-2 bg-slate-950/70 p-3 sm:p-4" style={{ borderColor: `${c1}aa` }}>
      <header className="mb-3 flex items-center gap-3">
        <button type="button" onClick={() => warden && onFocus(warden)} disabled={!warden?.name} className="shrink-0 transition-transform hover:scale-105 disabled:cursor-default" title={warden ? `Summon the Warden, ${warden.codename || warden.name}` : 'This house has no Warden'}>
          <Banner seed={house.seed} colours={house.colours} width={48} />
        </button>
        <div className="min-w-0 font-mono">
          <h2 className="truncate text-lg font-bold text-slate-100" style={{ textShadow: `2px 2px 0 ${c1}` }}>
            {house.house}
          </h2>
          <p className="truncate text-xs italic" style={{ color: c2 === '#1e293b' ? '#94a3b8' : c2 }}>
            “{house.motto}”
          </p>
          <p className="mt-1 truncate text-[11px] text-slate-400">
            Warden: {warden ? <span style={{ color: warden.colour || GREY }}>{warden.codename || warden.name}</span> : <span className="text-slate-600">none</span>}
            {warden && <span className="text-slate-500"> · {STATUS[warden.status]?.label || UNKNOWN.label}</span>}
            <span className="text-slate-600"> · {house.creatures.length} sworn</span>
            <span className="text-slate-600"> · {house.host === 'herdr-app' ? 'Herdr app' : 'cmux'}</span>
          </p>
        </div>
      </header>
      {house.creatures.length ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {house.creatures.map((a) => <CreatureCard key={a.paneId} agent={a} house={house.house} maxSpoils={maxSpoils} onFocus={onFocus} />)}
        </div>
      ) : (
        <p className="font-mono text-xs text-slate-500">No creatures have sworn to this house yet.</p>
      )}
    </section>
  )
}

export function DexPage() {
  const [agents, setAgents] = useState<HerdrAgent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showScene, setShowScene] = useState(true)
  const [updated, setUpdated] = useState<string | null>(null)

  const poll = useCallback(async () => {
    try {
      const g = await api.graph()
      setAgents(g.state.herdr)
      setUpdated(g.ts)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  usePolling(poll, 3000)

  const onFocus = useCallback(async (a: HerdrAgent) => {
    const target = focusTarget(a)
    if (!target) return
    try {
      const r = await api.herdrFocus(a.session, target)
      setError(r.ok ? null : String(r.error))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  const houses = useMemo(() => housesOf(agents || []), [agents])
  const maxSpoils = Math.max(SPOILS_CAP, ...(agents || []).map((a) => a.changedFiles ?? 0))

  return (
    <div className="space-y-4 font-mono">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span className="text-sm font-bold uppercase tracking-widest text-amber-300">Creature Dex</span>
        <span>
          {houses.length} houses · {houses.reduce((n, h) => n + h.creatures.length, 0)} creatures
        </span>
        <span className="flex items-center gap-1.5 text-slate-500">
          <span className={`inline-block h-2 w-2 rounded-full ${error ? 'bg-danger' : 'bg-ok animate-pulse'}`} />
          {updated ? `updated ${updated}` : 'loading…'}
        </span>
        <button type="button" onClick={() => setShowScene((v) => !v)} className="ml-auto rounded border border-slate-700 px-2 py-1 hover:bg-slate-800">
          {showScene ? 'Hide map' : 'Show map'}
        </button>
      </div>
      {error && <p className="rounded border border-red-500/50 bg-red-500/10 px-2 py-1 text-xs text-red-300">{error}</p>}
      {agents === null ? (
        <p className="text-xs text-slate-500">Consulting the scrolls…</p>
      ) : !houses.length ? (
        <p className="text-xs text-slate-500">The realm is quiet: no herdr sessions or Herdr app agents are running.</p>
      ) : (
        <>
          {showScene && (
            <div className="rounded-lg border-2 border-slate-800 bg-slate-950 p-2">
              <DexScene houses={houses} onFocus={onFocus} />
            </div>
          )}
          {REALMS.map(({ host, title }) => {
            const realm = houses.filter((h) => h.host === host)
            return realm.length ? (
              <section key={host} className="space-y-3">
                <h2 className="border-b border-slate-800 pb-1 text-sm font-bold uppercase tracking-widest text-amber-300">
                  {title} <span className="text-xs font-normal normal-case tracking-normal text-slate-500">· {realm.length} houses</span>
                </h2>
                {realm.map((h) => <HouseSection key={h.session} house={h} maxSpoils={maxSpoils} onFocus={onFocus} />)}
              </section>
            ) : null
          })}
        </>
      )}
    </div>
  )
}
