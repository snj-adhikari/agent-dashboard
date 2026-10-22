import { useState } from 'react'
import type { CmuxTab } from '../types'
import { api } from '../api'
import { Card, CardPath, CardMeta, Button } from './Card'
import { EmptyState } from './EmptyState'

function TabCard({ tab }: { tab: CmuxTab }) {
  const [expanded, setExpanded] = useState(false)
  const [screen, setScreen] = useState('')
  const [prompt, setPrompt] = useState('')
  const [loadingScreen, setLoadingScreen] = useState(false)
  const [sending, setSending] = useState(false)
  const [creatingArtifact, setCreatingArtifact] = useState(false)

  async function toggle() {
    if (expanded) {
      setExpanded(false)
      return
    }
    setExpanded(true)
    setLoadingScreen(true)
    try {
      const r = await api.screen(tab.ref)
      setScreen(r.ok ? r.screen || '' : 'Error: ' + r.error)
    } finally {
      setLoadingScreen(false)
    }
  }

  async function send() {
    if (!prompt) return
    setSending(true)
    try {
      await api.send(tab.ref, prompt)
      setPrompt('')
    } finally {
      setSending(false)
    }
  }

  async function createArtifact() {
    setCreatingArtifact(true)
    try {
      await api.send(tab.ref, 'Please create an Artifact summarizing your current work/output.')
    } finally {
      setCreatingArtifact(false)
    }
  }

  return (
    <Card accent="green">
      <div className="flex items-center gap-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-ok" />
        <b className="text-slate-100">{tab.ref}</b>
        <span className="text-slate-500">—</span>
        <span className="text-slate-300 truncate">{tab.title || '(no title)'}</span>
      </div>
      <CardPath>{tab.cwd}</CardPath>
      <CardMeta>last active {tab.lastActive || 'unknown'}</CardMeta>
      {tab.sessionId && (
        <CardMeta>
          <code className="rounded bg-slate-950 border border-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
            claude --resume {tab.sessionId}
          </code>
        </CardMeta>
      )}
      <div>
        <Button loading={loadingScreen} onClick={toggle}>
          {expanded ? 'Collapse output' : 'Expand output'}
        </Button>
        <Button loading={creatingArtifact} onClick={createArtifact}>
          Create artifact
        </Button>
      </div>
      <input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && send()}
        placeholder={sending ? 'Sending…' : 'Send a prompt to this session…'}
        disabled={sending}
        className="w-full box-border rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 mt-1.5 outline-none focus:border-emerald-600 disabled:opacity-60"
      />
      {expanded && (
        <pre className="mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-slate-800 bg-slate-950 p-2 text-[10px] text-slate-400">
          {screen}
        </pre>
      )}
    </Card>
  )
}

export function TabList({ tabs }: { tabs: CmuxTab[] }) {
  if (!tabs.length) return <EmptyState label="No cmux tabs open" />
  return (
    <>
      {tabs.map((t) => (
        <TabCard key={t.ref} tab={t} />
      ))}
    </>
  )
}
