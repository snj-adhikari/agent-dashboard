import { useEffect, useRef, useState } from 'react'
import { usePolling } from '../usePolling'
import { api } from '../api'
import type { InboxItem, InboxVerdict } from '../types'
import { InboxRow } from './HookStatusPanel'

const SEEN_KEY = 'agent-monitor:inbox-seen'
const SHOWN = 10
const BELL_POLL_MS = 15_000
const URGENT: InboxVerdict[] = ['pr-review', 'risky', 'heavy']

function readSeen(): string {
  try {
    return localStorage.getItem(SEEN_KEY) || ''
  } catch {
    return ''
  }
}

function writeSeen(at: string): void {
  try {
    localStorage.setItem(SEEN_KEY, at)
  } catch {
    return
  }
}

export function InboxBell({ onOpenInbox }: { onOpenInbox: () => void }) {
  const [items, setItems] = useState<InboxItem[]>([])
  const [seen, setSeen] = useState(readSeen)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  usePolling(() => {
    api.inbox().then((r) => setItems(r.inbox || [])).catch(() => {})
  }, BELL_POLL_MS)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const unread = items.filter((i) => i.at > seen)
  const urgent = unread.some((i) => URGENT.includes(i.verdict))

  function toggle() {
    if (!open && items.length) {
      writeSeen(items[0].at)
      setSeen(items[0].at)
    }
    setOpen(!open)
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        onClick={toggle}
        aria-label={`Notifications, ${unread.length} unread`}
        aria-haspopup="true"
        aria-expanded={open}
        className="relative rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread.length > 0 && (
          <span
            aria-hidden="true"
            className={`absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full px-1 text-center text-[10px] font-semibold leading-[1.1rem] ${
              urgent ? 'bg-red-600 text-white' : 'bg-slate-700 text-slate-200'
            }`}
          >
            {unread.length > 99 ? '99+' : unread.length}
          </span>
        )}
      </button>
      {open && (
        <div role="region" aria-label="Latest inbox items" className="absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-800 bg-slate-900 p-3 shadow-xl">
          <div className="mb-1 text-[11px] font-medium text-slate-300">Inbox</div>
          {items.length ? items.slice(0, SHOWN).map((item) => <InboxRow key={item.at + item.title} item={item} />) : <div className="py-1 text-[11px] text-slate-500">No notifications yet.</div>}
          <a
            href="/hooks#inbox"
            onClick={(e) => {
              e.preventDefault()
              setOpen(false)
              onOpenInbox()
            }}
            className="mt-2 block text-[11px] text-sky-300 underline-offset-2 hover:underline"
          >
            Open the Inbox on the Hooks page
          </a>
        </div>
      )}
    </div>
  )
}
