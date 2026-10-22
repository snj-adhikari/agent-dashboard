import { useState } from 'react'
import type { Repo } from '../types'
import { api } from '../api'

export function NewSessionModal({
  repo,
  onClose,
  onCreated
}: {
  repo: Repo
  onClose: () => void
  onCreated: () => void
}) {
  const [branch, setBranch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!branch) return
    setBusy(true)
    setError(null)
    const r = await api.newSession(repo.path, branch)
    setBusy(false)
    if (!r.ok) {
      setError(String(r.error))
      return
    }
    onCreated()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[440px] rounded-2xl border border-slate-700 bg-gradient-to-b from-slate-900 to-slate-950 p-8 shadow-2xl shadow-black/50 animate-[fadeIn_0.15s_ease-out]"
      >
        <h2 className="text-3xl font-bold text-white tracking-tight">{repo.name}</h2>
        <p className="mt-2 text-slate-400 text-sm">Spin up a new git worktree and start a Claude Code session</p>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-md border border-slate-700 bg-slate-800/70 px-2 py-1 text-[11px] text-slate-300">
            {repo.worktrees.length} worktree(s)
          </span>
          <span className="rounded-md border border-slate-700 bg-slate-800/70 px-2 py-1 text-[11px] text-slate-300">local-first</span>
          <span className="rounded-md border border-slate-700 bg-slate-800/70 px-2 py-1 text-[11px] text-slate-300">live sync</span>
        </div>

        <input
          autoFocus
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="type/slug e.g. fix/proj-123"
          className="mt-6 w-full box-border rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand"
        />
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || !branch}
            className="rounded-lg bg-brand-dark px-4 py-1.5 text-sm font-medium text-white hover:bg-brand disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create session'}
          </button>
        </div>

        <p className="mt-4 text-[10px] text-slate-600">{repo.path}</p>
      </div>
    </div>
  )
}
