import { useState } from 'react'
import type { AgentProcess } from '../types'
import { api } from '../api'
import { Card, CardPath, CardMeta, Button } from './Card'
import { EmptyState } from './EmptyState'

export function AgentList({ agents, onChange }: { agents: AgentProcess[]; onChange: () => void }) {
  const [busy, setBusy] = useState<Set<string>>(new Set())

  if (!agents.length) return <EmptyState label="No bare agent processes" />

  async function terminate(pid: string) {
    if (!confirm(`Terminate agent process ${pid}?`)) return
    setBusy((prev) => new Set(prev).add(pid))
    try {
      const r = await api.terminate(Number(pid))
      if (!r.ok) alert('Failed: ' + r.error)
      onChange()
    } finally {
      setBusy((prev) => {
        const next = new Set(prev)
        next.delete(pid)
        return next
      })
    }
  }

  return (
    <>
      {agents.map((a) => (
        <Card key={a.pid} accent="amber">
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-warn" />
            <b className="text-slate-100">{a.cmd}</b>
            <span className="text-slate-500 text-xs">pid {a.pid}</span>
          </div>
          <CardPath>{a.cwd}</CardPath>
          {a.sessionId && (
            <CardMeta>
              <code className="rounded bg-slate-950 border border-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                claude --resume {a.sessionId}
              </code>
            </CardMeta>
          )}
          <CardMeta>
            <Button danger loading={busy.has(a.pid)} onClick={() => terminate(a.pid)}>
              Terminate
            </Button>
          </CardMeta>
        </Card>
      ))}
    </>
  )
}
