import { useCallback, useState } from 'react'
import type { MonitorState, Repo } from '../types'
import { api, type InactiveWorktree } from '../api'
import { POLL_MS, usePolling } from '../usePolling'
import { Button, CardPath } from './Card'
import { Modal } from './Modal'

export function DeleteInactiveWorktrees({
  state,
  repo,
  onChange
}: {
  state: MonitorState
  repo?: Repo
  onChange: () => void
}) {
  const [data, setData] = useState<{ worktrees: InactiveWorktree[]; kept: { path: string; reason: string }[] } | null>(null)
  const [showing, setShowing] = useState(false)
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [errorBanner, setErrorBanner] = useState<string[] | null>(null)
  const [busy, setBusy] = useState<Set<string>>(new Set())

  async function withBusy(key: string, fn: () => Promise<void>) {
    setBusy((prev) => new Set(prev).add(key))
    try {
      await fn()
    } finally {
      setBusy((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  const load = useCallback(async () => {
    const r = await api.inactiveWorktrees().catch(() => null)
    if (r?.ok) setData(r)
  }, [])

  usePolling(load, POLL_MS)

  const repos = repo ? [repo] : state.repos
  const paths = new Set(repos.flatMap((x) => x.worktrees.map((wt) => wt.path)))
  const list = data?.worktrees.filter((w) => paths.has(w.path)) ?? []
  const kept = data?.kept.filter((k) => paths.has(k.path)) ?? []
  const count = list.length
  const clean = list.filter((w) => !w.dirty && !w.unpushed)
  const risky = list.filter((w) => w.dirty || w.unpushed)

  function open() {
    withBusy('load', async () => {
      await load()
      setTicked(new Set())
      setShowing(true)
    })
  }

  function confirm() {
    withBusy('delete', async () => {
      const cleanPaths = clean.map((w) => w.path)
      const tickedPaths = risky.map((w) => w.path).filter((p) => ticked.has(p))
      const batches = await Promise.all([
        cleanPaths.length ? api.removeWorktrees(cleanPaths, false) : null,
        tickedPaths.length ? api.removeWorktrees(tickedPaths, true) : null
      ])
      const results = batches.flatMap((b) => b?.results ?? [])
      const failed = results.filter((x) => !x.ok)
      setErrorBanner(failed.length ? failed.map((f) => `${f.path}: ${f.error}`) : null)
      setShowing(false)
      await load()
      onChange()
    })
  }

  return (
    <>
      {count > 0 && (
        <Button danger loading={busy.has('load')} onClick={open}>
          {repo ? 'Delete inactive' : 'Delete all inactive'} ({count})
        </Button>
      )}

      {errorBanner && (
        <Modal onClose={() => setErrorBanner(null)}>
          <div className="font-semibold text-red-300 mb-2">Delete failed</div>
          {errorBanner.map((e, i) => (
            <div key={i} className="text-slate-300 font-mono text-[11px] mb-1 break-all">
              {e}
            </div>
          ))}
          <div className="mt-3 text-right">
            <Button onClick={() => setErrorBanner(null)}>Dismiss</Button>
          </div>
        </Modal>
      )}

      {showing && count > 0 && (
        <Modal onClose={() => setShowing(false)}>
          <div className="font-semibold text-red-300 mb-2">Delete {count} inactive worktree(s)?</div>
          {kept.length > 0 && (
            <div className="mb-3 text-amber-300">
              <div>Skipped {kept.length} still in use or with an open PR:</div>
              {kept.map((k) => (
                <div key={k.path} className="break-all font-mono text-[11px] text-slate-400">
                  {k.path} · {k.reason}
                </div>
              ))}
            </div>
          )}
          {clean.length > 0 && (
            <div className="mb-3">
              <div className="text-slate-400 mb-1">Clean — deleted on confirm ({clean.length}):</div>
              {clean.map((w) => (
                <CardPath key={w.path}>
                  {w.repo} · {w.branch || 'detached'} · {w.path}
                </CardPath>
              ))}
            </div>
          )}
          {risky.length > 0 && (
            <div className="mb-3">
              <div className="text-slate-400 mb-1">
                Uncommitted or unpushed work — tick to force delete ({risky.length}):
              </div>
              {risky.map((w) => (
                <div key={w.path} className="mb-3 flex gap-2">
                  <input
                    type="checkbox"
                    className="mt-1 accent-brand-dark"
                    checked={ticked.has(w.path)}
                    onChange={() =>
                      setTicked((prev) => {
                        const next = new Set(prev)
                        next.has(w.path) ? next.delete(w.path) : next.add(w.path)
                        return next
                      })
                    }
                  />
                  <div className="flex-1 min-w-0">
                    <CardPath>
                      {w.repo} · {w.branch || 'detached'} · {w.path}
                    </CardPath>
                    <div className="text-slate-400 mt-1.5">git status --porcelain:</div>
                    <pre className="whitespace-pre-wrap font-mono text-[11px] text-slate-300">{w.dirty || '(none)'}</pre>
                    <div className="text-slate-400 mt-1.5">Unpushed commits:</div>
                    <pre className="whitespace-pre-wrap font-mono text-[11px] text-slate-300">{w.unpushed || '(none)'}</pre>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 text-right">
            <Button onClick={() => setShowing(false)}>Cancel</Button>
            <Button danger loading={busy.has('delete')} onClick={confirm}>
              Delete ({clean.length + ticked.size})
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}
