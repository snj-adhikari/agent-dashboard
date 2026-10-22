import { useState } from 'react'
import { POLL_MS, usePolling } from '../usePolling'
import type { HookStatus, HookStatusResponse, QueueItem } from '../types'
import { api } from '../api'
import { Card, CardMeta, Button } from './Card'

function timeAgo(iso: string | null): string | null {
  if (!iso) return null
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ago`
}

function TicketLink({ id, title, url }: { id: string; title: string; url?: string }) {
  const rest = title.startsWith(id) ? title.slice(id.length) : ` ${title}`
  const label = title.startsWith(id) ? id : title
  return (
    <>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-sky-300 underline-offset-2 hover:underline">
          {label}
        </a>
      ) : (
        <span className="text-slate-200">{label}</span>
      )}
      {title.startsWith(id) && <span className="text-slate-300">{rest}</span>}
    </>
  )
}

function HookCard({ hook, onChange }: { hook: HookStatus; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const paused = !hook.enabled || !!hook.autoPaused
  const state = !hook.enabled ? 'disabled' : hook.lastError ? 'error' : hook.usageGateOk && !hook.autoPaused ? 'ok' : 'blocked'
  const dot = state === 'disabled' ? 'bg-slate-600' : state === 'error' ? 'bg-danger' : state === 'blocked' ? 'bg-warn' : 'bg-ok'

  async function toggle() {
    setBusy(true)
    setError('')
    try {
      const r = await api.setHookEnabled(hook.name, paused)
      if (!r.ok) setError(r.error || 'failed')
      onChange()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card accent={state === 'ok' ? 'green' : 'amber'}>
      <div className="flex items-center gap-2 font-medium text-slate-200">
        <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
        {hook.name}
        {!hook.enabled && <span className="rounded bg-slate-800 px-1 text-[10px] font-normal text-slate-400">disabled</span>}
        <span className="ml-auto text-[11px] font-normal text-slate-500">polled {timeAgo(hook.lastPollAt) || 'not yet'}</span>
      </div>
      <div className="mt-1">
        <Button primary={!hook.enabled} loading={busy} onClick={toggle}>
          {paused ? 'Enable' : 'Disable'}
        </Button>
      </div>
      {!hook.enabled && <CardMeta>not polling or auto-starting; queued items wait, Run now still works</CardMeta>}
      {hook.enabled && hook.autoPaused && (
        <CardMeta>
          auto-paused:{' '}
          {hook.autoPaused.reason === 'queue'
            ? 'queue > 4'
            : `idle over 50% until ${new Date(hook.autoPaused.until * 1000).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}`}
        </CardMeta>
      )}
      {error && <CardMeta><span className="text-red-300">Failed: {error}</span></CardMeta>}
      {!hook.usageGateOk && hook.gateReason && <CardMeta>starts paused: {hook.gateReason} (still polling, queuing)</CardMeta>}
      {hook.lastError && <CardMeta><span className="text-red-300">error: {hook.lastError}</span></CardMeta>}
      {hook.flags.map((f) => <CardMeta key={f}><span className="text-amber-300">flag: {f}</span></CardMeta>)}
      {hook.recent.map((s) => (
        <CardMeta key={s.id + s.at}>
          <TicketLink id={s.id} title={s.title} url={s.url} />
          <span className="text-slate-500"> — {s.branch ? `${s.branch} · ` : ''}{s.ref} · {timeAgo(s.at)}</span>
        </CardMeta>
      ))}
    </Card>
  )
}

function QueueRow({ item, onRun }: { item: QueueItem; onRun: (id: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex items-start gap-2 border-t border-slate-800/70 py-1.5 first:border-t-0">
      <div className="min-w-0 flex-1 text-[11px]">
        <div className="text-slate-200 truncate">
          {item.urgent && <span className="mr-1 rounded bg-red-950 px-1 text-red-300">urgent</span>}
          <TicketLink id={item.id} title={item.title} url={item.url} />
        </div>
        <div className="text-slate-500">
          {[item.priority, item.type, item.repo, item.branch].filter(Boolean).join(' · ')} · queued {timeAgo(item.queuedAt)}
        </div>
      </div>
      <Button
        loading={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await onRun(item.id)
          } finally {
            setBusy(false)
          }
        }}
      >
        Run now
      </Button>
    </div>
  )
}

function QueueCard({ queue, onChange }: { queue: QueueItem[]; onChange: () => void }) {
  const [error, setError] = useState('')
  const [runningNext, setRunningNext] = useState(false)

  async function run(id?: string) {
    setError('')
    const r = await api.runQueued(id)
    if (!r.ok) setError(r.error || 'failed')
    onChange()
  }

  return (
    <Card accent="blue">
      <div className="mb-1 flex items-center">
        <span className="text-[11px] font-medium text-slate-300">Queue — {queue.length} pending (next first)</span>
        <span className="ml-auto">
          <Button
            primary
            loading={runningNext}
            onClick={async () => {
              setRunningNext(true)
              try {
                await run()
              } finally {
                setRunningNext(false)
              }
            }}
          >
            Run next
          </Button>
        </span>
      </div>
      <div className="text-[10px] text-slate-500 mb-1">Run now overrides the usage gate and the concurrency limit.</div>
      {queue.map((item) => (
        <QueueRow key={item.hook + item.id} item={item} onRun={run} />
      ))}
      {error && <div className="mt-1 text-[11px] text-red-300">Failed: {error}</div>}
    </Card>
  )
}

function StartTicket({ onStarted }: { onStarted: () => void }) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function start() {
    if (!key.trim()) return
    setBusy(true)
    setMessage('Fetching ticket and starting session…')
    try {
      const r = await api.startJiraTicket(key.trim())
      const id = key.trim().toUpperCase()
      setMessage(!r.ok ? `Failed: ${r.error}` : r.queued ? `Queued ${id} — ${r.reason}` : `Started ${id}`)
      if (r.ok) setKey('')
      onStarted()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-1">
      <div className="flex gap-1.5">
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && start()}
          placeholder="Start a ticket now, e.g. PROJ-123"
          aria-label="Jira ticket key"
          disabled={busy}
          className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-emerald-600 disabled:opacity-60"
        />
        <Button primary loading={busy} onClick={start}>
          Start
        </Button>
      </div>
      {message && <div className="mt-1 text-[11px] text-slate-400">{message}</div>}
    </div>
  )
}

export function HookStatusPanel() {
  const [data, setData] = useState<HookStatusResponse | null>(null)

  const poll = () => {
    api.hookStatus().then(setData).catch(() => {})
  }

  usePolling(poll, POLL_MS)

  if (!data) return null

  return (
    <>
      <div className="mb-1.5 text-[11px] text-slate-500">
        max {data.maxConcurrent} at a time · {data.queue.length} queued
      </div>
      {data.hooks.map((h) => (
        <HookCard key={h.name} hook={h} onChange={poll} />
      ))}
      {data.queue.length > 0 && <QueueCard queue={data.queue} onChange={poll} />}
      {data.sessions.length > 0 && (
        <Card accent="green">
          <div className="mb-1 text-[11px] font-medium text-slate-300">Sessions reporting via mod</div>
          {data.sessions.map((x) => (
            <CardMeta key={x.sessionId}>
              <span className="text-slate-200">{x.ticket}</span>
              <span className="text-slate-500"> — {x.phase} · {x.branch || x.hook} · {timeAgo(x.at)}</span>
            </CardMeta>
          ))}
        </Card>
      )}
      <StartTicket onStarted={poll} />
    </>
  )
}
