import { useState } from 'react'
import type { HerdrAgent } from '../types'
import { api } from '../api'
import { Button, CardMeta, CardPath } from './Card'
import { EmptyState } from './EmptyState'

const STATUS: Record<string, { symbol: string; className: string }> = {
  blocked: { symbol: '⚠', className: 'text-red-400' },
  working: { symbol: '◐', className: 'text-amber-400' },
  done: { symbol: '✓', className: 'text-emerald-400' },
  idle: { symbol: '○', className: 'text-slate-400' }
}

function HerdrCard({ agent }: { agent: HerdrAgent }) {
  const [expanded, setExpanded] = useState(false)
  const [screen, setScreen] = useState('')
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [focusing, setFocusing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const status = STATUS[agent.status] || { symbol: '?', className: 'text-slate-500' }
  const colour = agent.colour || '#64748b'

  async function toggle() {
    if (expanded) return setExpanded(false)
    setExpanded(true)
    setLoading(true)
    try {
      const r = await api.herdrRead(agent.session, agent.paneId)
      setScreen(r.ok ? r.screen || '' : 'Error: ' + r.error)
    } catch (e) {
      setScreen('Error: ' + (e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function send() {
    if (!prompt) return
    setSending(true)
    setError(null)
    try {
      const r = await api.herdrPrompt(agent.session, agent.paneId, prompt)
      if (r.ok) setPrompt('')
      else setError(r.code === 'agent_blocked' ? 'Agent is waiting on a question or approval; answer it in herdr first' : String(r.error))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  async function focus() {
    if (!agent.name) return
    setFocusing(true)
    setError(null)
    try {
      const r = await api.herdrFocus(agent.session, agent.name)
      if (!r.ok) setError(String(r.error))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setFocusing(false)
    }
  }

  return (
    <div
      className="rounded-lg border border-slate-800 border-l-4 bg-slate-900/60 p-3 mb-2 text-sm transition-colors hover:border-slate-700 hover:bg-slate-900"
      style={{ borderLeftColor: colour }}
    >
      <div className="flex items-center gap-1.5">
        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colour }} />
        <b className="text-base" style={{ color: colour }}>
          {agent.codename || agent.label || agent.name || agent.paneId}
        </b>
        {agent.name && <code className="rounded bg-slate-950 border border-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">{agent.name}</code>}
        {agent.ticket && <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-200">{agent.ticket}</span>}
        <span className={`ml-auto text-[11px] ${status.className}`} title={agent.status}>
          {status.symbol} {agent.status}
        </span>
      </div>
      <div className="mt-1 text-slate-200 truncate" title={agent.title}>
        {agent.title || '(no activity reported)'}
      </div>
      <CardMeta>
        {agent.branch && <span className="mr-2 font-mono">{agent.branch}</span>}
        {agent.changedFiles !== undefined && <span className="mr-2">{agent.changedFiles} changed file(s)</span>}
        <span className="text-slate-500">
          {agent.agent} · {agent.paneId}
          {agent.tabTitle ? ` · ${agent.tabTitle}` : ''}
        </span>
      </CardMeta>
      <CardPath>{agent.worktree || agent.cwd}</CardPath>
      <Button loading={loading} onClick={toggle}>
        {expanded ? 'Collapse output' : 'Read output'}
      </Button>
      {agent.name && (
        <Button loading={focusing} onClick={focus}>
          Focus
        </Button>
      )}
      <input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && send()}
        placeholder={sending ? 'Sending…' : 'Send a prompt to this agent…'}
        disabled={sending}
        className="w-full box-border rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 mt-1.5 outline-none focus:border-purple-500 disabled:opacity-60"
      />
      {error && <p className="mt-1 text-[11px] text-red-400">{error}</p>}
      {expanded && (
        <pre className="mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-slate-800 bg-slate-950 p-2 text-[10px] text-slate-400">
          {screen}
        </pre>
      )}
    </div>
  )
}

function groupBy<T>(items: T[], key: (item: T) => string): [string, T[]][] {
  const groups = new Map<string, T[]>()
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) || []), item])
  return [...groups]
}

const LAST_SESSIONS = ['drive-pr-review', 'drive-generic']

const scopeRank = (inScope: HerdrAgent[]): number => {
  const i = LAST_SESSIONS.indexOf(inScope[0].session)
  return i < 0 ? -1 : i
}

export function HerdrList({ agents }: { agents: HerdrAgent[] }) {
  if (!agents.length) return <EmptyState label="No herdr session running" />
  const scopes = groupBy(agents, (a) => a.display || a.session).sort(([, a], [, b]) => scopeRank(a) - scopeRank(b))
  return (
    <>
      {scopes.map(([scope, inScope]) => (
        <div key={scope} className="mb-3">
          <div className="mb-1 text-[11px] font-semibold text-purple-300">{scope}</div>
          {groupBy(inScope, (a) => a.ticket || 'No ticket').map(([ticket, inTicket]) => (
            <div key={ticket} className="ml-1">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">{ticket}</div>
              {inTicket.map((a) => (
                <HerdrCard key={`${a.session}/${a.paneId}`} agent={a} />
              ))}
            </div>
          ))}
        </div>
      ))}
    </>
  )
}
