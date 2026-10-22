import { useState } from 'react'
import type { MonitorState } from '../types'
import { api } from '../api'
import { Card, CardPath, CardMeta, Button } from './Card'
import { EmptyState } from './EmptyState'
import { Modal } from './Modal'
import { DeleteInactiveWorktrees } from './DeleteInactiveWorktrees'

export function WorktreeList({ state, onChange }: { state: MonitorState; onChange: () => void }) {
  const { repos, tabs } = state
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [forceConfirm, setForceConfirm] = useState<{ path: string; status: string; unpushed: string }[] | null>(null)
  const [forceSelected, setForceSelected] = useState<Set<string>>(new Set())
  const [errorBanner, setErrorBanner] = useState<string[] | null>(null)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const tabsByCwd = Object.fromEntries(tabs.map((t) => [t.cwd, t]))

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

  const FORCE_ELIGIBLE = /contains modified or untracked files|is locked/

  async function statusFor(path: string) {
    const info = await api.worktreeStatus(path)
    return { path, status: info.status || '(none)', unpushed: info.unpushed || '(none)' }
  }

  const groups = repos
    .map((repo) => ({
      repo,
      worktrees: repo.worktrees
        .filter((wt) => !wt.isMain)
        .sort((a, b) => Number(!!tabsByCwd[b.path]) - Number(!!tabsByCwd[a.path]))
    }))
    .filter((g) => g.worktrees.length)

  if (!groups.length) return <EmptyState label="No worktrees beyond main checkouts" />

  function toggle(path: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }

  async function deleteOne(path: string) {
    await withBusy(path, async () => {
      const r = await api.removeWorktree(path)
      if (r.ok) {
        onChange()
        return
      }
      if (FORCE_ELIGIBLE.test((r as { error?: string }).error || '')) {
        setForceConfirm([await statusFor(path)])
        setForceSelected(new Set([path]))
      } else {
        setErrorBanner([`${path}: ${(r as { error?: string }).error}`])
      }
    })
  }

  async function forceDelete() {
    if (!forceConfirm) return
    const paths = forceConfirm.map((f) => f.path).filter((p) => forceSelected.has(p))
    if (!paths.length) return
    await withBusy('force', async () => {
      const r = await api.removeWorktrees(paths, true)
      const failed = r.results.filter((x) => !x.ok)
      setErrorBanner(failed.length ? failed.map((f) => `${f.path}: ${f.error}`) : null)
      setForceConfirm(null)
      onChange()
    })
  }

  async function removeMany(key: string, paths: string[]) {
    if (!paths.length) return
    await withBusy(key, async () => {
      const r = await api.removeWorktrees(paths)
      const failed = r.results.filter((x) => !x.ok)
      const forceEligible = failed.filter((f) => FORCE_ELIGIBLE.test(f.error || ''))
      const other = failed.filter((f) => !forceEligible.includes(f))
      setErrorBanner(other.length ? other.map((f) => `${f.path}: ${f.error}`) : null)
      if (forceEligible.length) {
        setForceConfirm(await Promise.all(forceEligible.map((f) => statusFor(f.path))))
        setForceSelected(forceEligible.length === 1 ? new Set([forceEligible[0].path]) : new Set())
      }
      setSelected(new Set())
      onChange()
    })
  }

  return (
    <div>
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

      {forceConfirm && (
        <Modal onClose={() => setForceConfirm(null)}>
          <div className="font-semibold text-red-300 mb-2">
            {forceConfirm.length === 1
              ? 'Worktree has uncommitted or unpushed work — force delete anyway?'
              : `${forceConfirm.length} worktree(s) have uncommitted or unpushed work. Tick which to force delete — unticked worktrees are left untouched.`}
          </div>
          {forceConfirm.map((f) => (
            <div key={f.path} className="mb-3 flex gap-2">
              {forceConfirm.length > 1 && (
                <input
                  type="checkbox"
                  className="mt-1 accent-brand-dark"
                  checked={forceSelected.has(f.path)}
                  onChange={() =>
                    setForceSelected((prev) => {
                      const next = new Set(prev)
                      next.has(f.path) ? next.delete(f.path) : next.add(f.path)
                      return next
                    })
                  }
                />
              )}
              <div className="flex-1 min-w-0">
                <CardPath>{f.path}</CardPath>
                <div className="text-slate-400 mt-1.5">git status --porcelain:</div>
                <pre className="whitespace-pre-wrap font-mono text-[11px] text-slate-300">{f.status}</pre>
                <div className="text-slate-400 mt-1.5">Unpushed commits:</div>
                <pre className="whitespace-pre-wrap font-mono text-[11px] text-slate-300">{f.unpushed}</pre>
              </div>
            </div>
          ))}
          <div className="mt-2 text-right">
            <Button onClick={() => setForceConfirm(null)}>Cancel</Button>
            <Button danger loading={busy.has('force')} onClick={forceDelete}>
              Force delete{forceConfirm.length > 1 ? ` (${forceSelected.size})` : ''}
            </Button>
          </div>
        </Modal>
      )}

      {selected.size > 0 && (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2">
          <span className="text-xs font-medium text-red-200">{selected.size} selected</span>
          <div className="flex items-center gap-3">
            <button onClick={() => setSelected(new Set())} className="text-xs text-slate-400 hover:text-slate-200">
              Clear
            </button>
            <Button danger loading={busy.has('selected')} onClick={() => removeMany('selected', [...selected])}>
              Delete selected
            </Button>
          </div>
        </div>
      )}

      {groups.map(({ repo, worktrees }) => {
        const allSelected = worktrees.every((wt) => selected.has(wt.path))
        return (
          <div key={repo.path} className="mb-4">
            <div className="mb-1.5 flex items-center justify-between border-b border-slate-800 pb-1.5">
              <label className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                <input
                  type="checkbox"
                  className="accent-brand-dark"
                  checked={allSelected}
                  onChange={() =>
                    setSelected((prev) => {
                      const next = new Set(prev)
                      if (allSelected) worktrees.forEach((wt) => next.delete(wt.path))
                      else worktrees.forEach((wt) => next.add(wt.path))
                      return next
                    })
                  }
                />
                {repo.name}
                <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] font-normal text-slate-400">
                  {worktrees.length}
                </span>
              </label>
              <div className="flex items-center gap-2">
                <DeleteInactiveWorktrees state={state} repo={repo} onChange={onChange} />
                <Button
                  danger
                  loading={busy.has(`group:${repo.path}`)}
                  onClick={() =>
                    removeMany(
                      `group:${repo.path}`,
                      worktrees.map((wt) => wt.path)
                    )
                  }
                >
                  Clear all
                </Button>
              </div>
            </div>

            {worktrees.map((wt) => {
              const tab = tabsByCwd[wt.path]
              return (
                <Card key={wt.path} accent={tab ? 'blue' : undefined}>
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1 accent-brand-dark"
                      checked={selected.has(wt.path)}
                      onChange={() => toggle(wt.path)}
                    />
                    <div className="flex-1 min-w-0">
                      <b className="text-slate-100">🌿 {wt.branch || 'detached'}</b>
                      <CardPath>📁 {wt.path}</CardPath>
                      <CardMeta>{tab ? `active tab: ${tab.ref}` : 'no active tab'}</CardMeta>
                      {(!!wt.changedFiles || wt.pr) && (
                        <div className="flex flex-wrap gap-1.5 mb-1.5">
                          {!!wt.changedFiles && (
                            <span className="rounded-full bg-amber-950/70 border border-amber-900/50 px-2 py-0.5 text-[10px] text-amber-300">
                              {wt.changedFiles} file{wt.changedFiles === 1 ? '' : 's'} changed
                            </span>
                          )}
                          {wt.pr && (
                            <a
                              href={wt.pr.url}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-full bg-purple-950/70 border border-purple-900/50 px-2 py-0.5 text-[10px] text-purple-300 hover:underline"
                            >
                              PR #{wt.pr.number} ({wt.pr.state})
                            </a>
                          )}
                        </div>
                      )}
                      <Button danger loading={busy.has(wt.path)} onClick={() => deleteOne(wt.path)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
