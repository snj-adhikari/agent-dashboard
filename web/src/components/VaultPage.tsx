import { useEffect, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { EmptyState } from './EmptyState'
import { NoteGraph } from './NoteGraph'
import { trackedFetch as fetch } from '../progress'

type VaultView = 'graph' | 'files'

interface VaultNode {
  name: string
  relPath: string
  type: 'file' | 'dir'
  children?: VaultNode[]
}

function TreeNode({
  node,
  depth,
  selected,
  onSelect
}: {
  node: VaultNode
  depth: number
  selected: string | null
  onSelect: (relPath: string) => void
}) {
  const [open, setOpen] = useState(depth < 1)

  if (node.type === 'file') {
    return (
      <div
        onClick={() => onSelect(node.relPath)}
        style={{ paddingLeft: depth * 14 }}
        className={`cursor-pointer rounded px-2 py-1 text-xs truncate ${
          selected === node.relPath ? 'bg-brand-dark/20 text-brand' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
        }`}
      >
        📄 {node.name.replace(/\.md$/, '')}
      </div>
    )
  }

  return (
    <div>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ paddingLeft: depth * 14 }}
        className="cursor-pointer rounded px-2 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800"
      >
        {open ? '📂' : '📁'} {node.name}
      </div>
      {open && node.children?.map((c) => <TreeNode key={c.relPath} node={c} depth={depth + 1} selected={selected} onSelect={onSelect} />)}
    </div>
  )
}

function SubNavButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
        active ? 'bg-brand-dark text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
      }`}
    >
      {children}
    </button>
  )
}

export function VaultPage() {
  const [view, setView] = useState<VaultView>('graph')
  const [tree, setTree] = useState<VaultNode[]>([])
  const [exists, setExists] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [html, setHtml] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/vault/tree')
      .then((r) => r.json())
      .then((j) => {
        setExists(j.exists)
        setTree(j.tree || [])
      })
  }, [])

  async function select(relPath: string) {
    setSelected(relPath)
    setView('files')
    setLoadError(null)
    setHtml('')
    setLoading(true)
    const r = await fetch('/api/vault/file?path=' + encodeURIComponent(relPath))
    const j = await r.json()
    if (!j.ok) {
      setLoadError(j.error)
      setLoading(false)
      return
    }
    const withoutFrontmatter = j.content.replace(/^---\n[\s\S]*?\n---\n/, '')
    const raw = await marked.parse(withoutFrontmatter)
    setHtml(DOMPurify.sanitize(raw))
    setLoading(false)
  }

  if (!exists) {
    return (
      <div>
        <EmptyState label="No vault configured." />
        <a
          href="/setup"
          onClick={(e) => {
            e.preventDefault()
            window.history.pushState(null, '', '/setup')
            window.dispatchEvent(new PopStateEvent('popstate'))
          }}
          className="mt-2 inline-block text-xs text-sky-300 hover:underline"
        >
          Set the vault folder in Setup
        </a>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 flex gap-1 rounded-xl border border-slate-800 bg-slate-900/80 p-1 w-fit">
        <SubNavButton active={view === 'graph'} onClick={() => setView('graph')}>
          Graph
        </SubNavButton>
        <SubNavButton active={view === 'files'} onClick={() => setView('files')}>
          Files
        </SubNavButton>
      </div>

      {view === 'graph' ? (
        <NoteGraph onSelect={select} expanded />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
          <aside className="rounded-2xl border border-slate-800 bg-slate-900 p-2 max-h-[80vh] overflow-y-auto">
            {tree.length ? (
              tree.map((n) => <TreeNode key={n.relPath} node={n} depth={0} selected={selected} onSelect={select} />)
            ) : (
              <p className="p-2 text-xs text-slate-600">No markdown files found</p>
            )}
          </aside>

          <section className="rounded-2xl border border-slate-800 bg-white p-8 max-h-[80vh] overflow-y-auto">
            {!selected && <p className="text-sm text-slate-500">Select a file from the vault to preview it.</p>}
            {loading && <p className="text-sm text-slate-500">Loading…</p>}
            {loadError && <p className="text-sm text-red-600">Error: {loadError}</p>}
            {selected && !loading && !loadError && (
              <article className="vault-markdown-light text-sm text-slate-900" dangerouslySetInnerHTML={{ __html: html }} />
            )}
          </section>
        </div>
      )}
    </div>
  )
}
