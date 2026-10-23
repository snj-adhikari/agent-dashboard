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
  usePolling(() => {
    fetch('/api/mobile/pulse')
      .then((r) => r.json())
      .then((j) => setUp(!!j.ok))
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

function SessionView({ session, onBack }: { session: MobileSession; onBack: () => void }) {
  const [screen, setScreen] = useState('')
  const [text, setText] = useState('')
  const [status, setStatus] = useState('')
  const pre = useRef<HTMLPreElement>(null)

  usePolling(() => {
    api.screen(session.ref).then((r) => setScreen(r.ok ? r.screen || '' : r.error || 'cannot read screen'))
  }, 3000, session.ref)

  useEffect(() => {
    pre.current?.scrollTo(0, pre.current.scrollHeight)
  }, [screen])

  async function send(value: string) {
    if (!value.trim()) return
    const r = await api.send(session.ref, value)
    setStatus(r.ok ? 'sent' : r.error || 'failed')
    if (r.ok) setText('')
  }

  return (
    <div className="flex h-dvh flex-col">
      <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
        <button className="text-sm text-sky-300" onClick={onBack}>Back</button>
        <span className="truncate text-sm font-medium text-slate-200">{session.title}</span>
      </div>
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
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder="Prompt"
            className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          />
          <button type="submit" className="rounded-lg bg-brand-dark px-4 text-sm font-medium text-white">Send</button>
        </form>
      </div>
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
          <li key={s.ref}>
            <button onClick={() => open(s.ref)} className="w-full rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-left">
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
          </li>
        ))}
        {!sessions.length && <li className="text-sm text-slate-500">No terminal sessions</li>}
      </ul>
    </div>
  )
}
