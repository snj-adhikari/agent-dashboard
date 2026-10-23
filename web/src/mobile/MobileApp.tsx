import { useEffect, useRef, useState } from 'react'
import { usePolling } from '../usePolling'
import { api } from '../api'

interface MobileSession {
  ref: string
  id: string
  title: string
  cwd: string
  lastActive: string | null
  phase: string
}

const QUICK_REPLIES = ['1', '2', '3', 'continue']

interface InstallPrompt extends Event {
  prompt(): Promise<void>
}

/** Chrome fires this once, often before React mounts, so it is caught at module load. */
let installPrompt: InstallPrompt | null = null
const installListeners = new Set<() => void>()
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  installPrompt = e as InstallPrompt
  installListeners.forEach((fn) => fn())
})

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json())

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const raw = atob((base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

async function pushSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker?.getRegistration('/m/')
  return (await reg?.pushManager.getSubscription()) ?? null
}

function Pulse() {
  const [up, setUp] = useState<boolean | null>(null)
  const build = useRef('')
  usePolling(() => {
    fetch('/api/mobile/pulse')
      .then((r) => r.json())
      .then((j) => {
        setUp(!!j.ok)
        if (j.build && build.current && j.build !== build.current) window.location.reload()
        build.current ||= j.build
      })
      .catch(() => setUp(false))
  }, 10_000)
  const dot = up === null ? 'bg-slate-600' : up ? 'bg-ok' : 'bg-danger'
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-400">
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
      {up === false ? 'Mac unreachable, check Tailscale' : 'connected'}
    </span>
  )
}

function InstallButton() {
  const [prompt, setPrompt] = useState(installPrompt)
  const [installed, setInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches)

  useEffect(() => {
    const onPrompt = () => setPrompt(installPrompt)
    const onInstalled = () => setInstalled(true)
    installListeners.add(onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      installListeners.delete(onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  async function install() {
    await prompt?.prompt()
    installPrompt = null
    setPrompt(null)
  }

  if (installed) return null
  if (prompt) {
    return (
      <button className="rounded-lg bg-brand-dark px-3 py-1.5 text-xs font-medium text-white" onClick={install}>
        Install app
      </button>
    )
  }
  const hint = /iPhone|iPad|iPod/.test(navigator.userAgent)
    ? 'iPhone: tap Share, then Add to Home Screen.'
    : 'Android: Chrome menu (⋮), then Add to home screen, then Install (or Create shortcut).'
  return <p className="text-xs text-slate-500">{hint}</p>
}

function NotifyToggle() {
  const [on, setOn] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    pushSubscription().then((s) => setOn(!!s)).catch(() => {})
  }, [])

  async function enable() {
    setError('')
    try {
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('permission denied')
      const reg = await navigator.serviceWorker.ready
      const { key } = await fetch('/api/push/key').then((r) => r.json())
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) })
      if (!(await post('/api/push/subscribe', sub.toJSON())).ok) throw new Error('server rejected the subscription')
      setOn(true)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function disable() {
    const sub = await pushSubscription()
    if (sub) {
      await post('/api/push/unsubscribe', { endpoint: sub.endpoint })
      await sub.unsubscribe()
    }
    setOn(false)
  }

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return <p className="text-xs text-slate-500">Notifications need HTTPS (open via tailscale serve)</p>
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <button className="rounded-lg bg-slate-800 px-3 py-1.5 text-slate-200" onClick={on ? disable : enable}>
        {on ? 'Notifications on' : 'Enable notifications'}
      </button>
      {on && (
        <button className="rounded-lg bg-slate-800 px-3 py-1.5 text-slate-400" onClick={() => post('/api/push/test', {})}>
          Test
        </button>
      )}
      {error && <span className="text-red-300">{error}</span>}
    </div>
  )
}

interface Surface {
  ref: string
  type: string
  title: string
  focused: boolean
}

const chip = (active: boolean) => `shrink-0 max-w-[45vw] truncate rounded-lg px-3 py-1.5 text-xs ${active ? 'bg-brand-dark text-white' : 'bg-slate-800 text-slate-300'}`
const input = 'min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100'

function TerminalPane({ workspace, surface, status, onSend }: { workspace: string; surface?: string; status: string; onSend: (text: string) => Promise<boolean> }) {
  const [screen, setScreen] = useState('')
  const [text, setText] = useState('')
  const pre = useRef<HTMLPreElement>(null)

  usePolling(() => {
    api.screen(workspace, surface).then((r) => setScreen(r.ok ? r.screen || '' : r.error || 'cannot read screen'))
  }, 3000, `${workspace}|${surface}`)

  useEffect(() => {
    pre.current?.scrollTo(0, pre.current.scrollHeight)
  }, [screen])

  async function send(value: string) {
    if (value.trim() && (await onSend(value))) setText('')
  }

  return (
    <>
      <pre ref={pre} className="flex-1 overflow-auto whitespace-pre-wrap break-words px-3 py-2 text-[11px] leading-snug text-slate-300">{screen}</pre>
      <div className="space-y-2 border-t border-slate-800 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex gap-2">
          {QUICK_REPLIES.map((q) => (
            <button key={q} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-200" onClick={() => send(q)}>
              {q}
            </button>
          ))}
          {status && <span className="self-center text-xs text-slate-500">{status}</span>}
        </div>
        <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), send(text))}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Prompt" className={input} />
          <button type="submit" className="rounded-lg bg-brand-dark px-4 text-sm font-medium text-white">Send</button>
        </form>
      </div>
    </>
  )
}

function BrowserPane({ surface }: { surface: string }) {
  const [tick, setTick] = useState(0)
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [status, setStatus] = useState('')

  usePolling(() => setTick((t) => t + 1), 2500, surface)

  async function act(body: Record<string, unknown>) {
    const r = await post('/api/mobile/browser', { surface, ...body })
    setStatus(r.ok ? '' : r.error || 'failed')
    setTimeout(() => setTick((t) => t + 1), 600)
    return r.ok as boolean
  }

  function tap(e: React.MouseEvent<HTMLImageElement>) {
    const box = e.currentTarget.getBoundingClientRect()
    act({ action: 'click', fx: (e.clientX - box.left) / box.width, fy: (e.clientY - box.top) / box.height })
  }

  return (
    <>
      <div className="flex-1 overflow-auto bg-black">
        <img src={`/api/mobile/browser/shot?surface=${encodeURIComponent(surface)}&t=${tick}`} onClick={tap} alt="Browser tab" className="w-full" />
      </div>
      <div className="space-y-2 border-t border-slate-800 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), act({ action: 'goto', url: /^https?:\/\//.test(url) ? url : `https://${url}` }))}>
          <button type="button" className={chip(false)} onClick={() => act({ action: 'back' })}>Back</button>
          <button type="button" className={chip(false)} onClick={() => act({ action: 'reload' })}>Reload</button>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Go to URL" inputMode="url" className={input} />
        </form>
        <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), act({ action: 'type', text, enter: true }).then((ok) => ok && setText('')))}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type into the focused field" className={input} />
          <button type="submit" className="rounded-lg bg-brand-dark px-4 text-sm font-medium text-white">Enter</button>
        </form>
        {status && <p className="text-xs text-red-300">{status}</p>}
      </div>
    </>
  )
}

/** Destructive actions need a second tap within 3 seconds; the viewer has no confirm() dialog. */
function ConfirmButton({ label, title, onConfirm }: { label: string; title: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])

  return (
    <button aria-label={title} title={title} className={`shrink-0 rounded-lg px-3 py-1.5 text-xs ${armed ? 'bg-danger text-white' : 'bg-slate-800 text-slate-300'}`} onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? 'Tap again' : label}
    </button>
  )
}

function SessionView({ session, onBack }: { session: MobileSession; onBack: () => void }) {
  const [surfaces, setSurfaces] = useState<Surface[]>([])
  const [picked, setPicked] = useState('')
  const [status, setStatus] = useState('')
  const [title, setTitle] = useState(session.title)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState('')

  usePolling(() => {
    fetch('/api/mobile/surfaces?ref=' + encodeURIComponent(session.ref))
      .then((r) => r.json())
      .then((j) => j.ok && setSurfaces(j.surfaces))
      .catch(() => {})
  }, 5000, session.ref)

  const current = surfaces.find((s) => s.ref === picked) || surfaces.find((s) => s.focused) || surfaces[0]

  async function send(value: string) {
    const r = await api.send(session.ref, value, current?.type === 'terminal' ? current.ref : undefined)
    setStatus(r.ok ? 'sent' : r.error || 'failed')
    return r.ok
  }

  async function tabAction(body: Record<string, unknown>) {
    const r = await post('/api/mobile/tab', { ref: session.ref, ...body })
    if (!r.ok) setStatus(r.error || 'failed')
    return r.ok as boolean
  }

  async function rename() {
    if (await tabAction({ action: 'rename', title: name })) {
      setTitle(name.trim())
      setRenaming(false)
    }
  }

  async function closePane(surface: string) {
    if (await tabAction({ action: 'close', surface })) {
      setSurfaces((all) => all.filter((s) => s.ref !== surface))
      setPicked('')
    }
  }

  return (
    <div className="flex h-dvh flex-col">
      <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
        <button className="shrink-0 text-sm text-sky-300" onClick={onBack}>← Back</button>
        {renaming ? (
          <form className="flex min-w-0 flex-1 gap-2" onSubmit={(e) => (e.preventDefault(), rename())}>
            <input id="tab-name" autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label="Tab name" className={input} />
            <button type="submit" className={chip(true)}>Save</button>
            <button type="button" className={chip(false)} onClick={() => setRenaming(false)}>Cancel</button>
          </form>
        ) : (
          <>
            <button className="min-w-0 flex-1 truncate text-left text-sm font-medium text-slate-200" title="Tap to rename" onClick={() => (setName(title), setRenaming(true))}>
              {title} <span className="text-slate-500">✎</span>
            </button>
            <button className={chip(false)} onClick={() => (setName(title), setRenaming(true))}>Rename</button>
            <ConfirmButton label="✕" title="Close tab" onConfirm={() => tabAction({ action: 'close' }).then((ok) => ok && onBack())} />
          </>
        )}
      </div>
      {surfaces.length > 1 && (
        <div className="flex gap-2 overflow-x-auto border-b border-slate-800 px-3 py-2">
          {surfaces.map((s) => (
            <span key={s.ref} className="flex shrink-0 items-center gap-1">
              <button className={chip(s.ref === current?.ref)} onClick={() => setPicked(s.ref)}>
                {s.type === 'browser' ? 'Web' : 'Term'} · {s.title || s.ref}
              </button>
              <ConfirmButton label="✕" title="Close pane" onConfirm={() => closePane(s.ref)} />
            </span>
          ))}
        </div>
      )}
      {current?.type === 'browser' ? (
        <BrowserPane key={current.ref} surface={current.ref} />
      ) : (
        <TerminalPane key={current?.ref || session.ref} workspace={session.ref} surface={current?.ref} status={status} onSend={send} />
      )}
    </div>
  )
}

export function MobileApp() {
  const [sessions, setSessions] = useState<MobileSession[]>([])
  const [ref, setRef] = useState(() => new URLSearchParams(window.location.search).get('ref') || '')

  usePolling(() => {
    fetch('/api/mobile/sessions')
      .then((r) => r.json())
      .then((j) => j.ok && setSessions(j.sessions))
      .catch(() => {})
  }, 5000)

  async function closeTab(tab: string) {
    const r = await post('/api/mobile/tab', { action: 'close', ref: tab })
    if (r.ok) setSessions((all) => all.filter((s) => s.ref !== tab))
  }

  function open(next: string) {
    window.history.replaceState(null, '', next ? `/m/?ref=${encodeURIComponent(next)}` : '/m/')
    setRef(next)
  }

  const selected = sessions.find((s) => s.ref === ref || s.id === ref)
  if (selected) return <SessionView session={selected} onBack={() => open('')} />

  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-100">Agents</h1>
        <Pulse />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <InstallButton />
        <NotifyToggle />
      </div>
      <ul className="space-y-2">
        {sessions.map((s) => (
          <li key={s.ref} className="flex items-center gap-2">
            <button onClick={() => open(s.ref)} className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-left">
              <div className="flex items-center gap-2">
                {s.phase === 'awaiting-you' && <span className="inline-block h-2 w-2 rounded-full bg-warn" />}
                <span className="truncate text-sm font-medium text-slate-200">{s.title}</span>
              </div>
              <div className="mt-0.5 truncate text-xs text-slate-500">
                {s.phase === 'awaiting-you' ? 'waiting for you · ' : ''}
                {s.cwd.split('/').slice(-2).join('/')}
                {s.lastActive ? ` · ${s.lastActive}` : ''}
              </div>
            </button>
            <ConfirmButton label="✕" title="Close tab" onConfirm={() => closeTab(s.ref)} />
          </li>
        ))}
        {!sessions.length && <li className="text-sm text-slate-500">No terminal sessions</li>}
      </ul>
    </div>
  )
}
