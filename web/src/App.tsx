import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { POLL_MS, usePolling } from './usePolling'
import type { GraphResponse, Repo } from './types'
import { api } from './api'
import { StatBar } from './components/StatBar'
import { MermaidGraph } from './components/MermaidGraph'
import { TabList } from './components/TabList'
import { AgentList } from './components/AgentList'
import { WorktreeList } from './components/WorktreeList'
import { NewSessionModal } from './components/NewSessionModal'
import { RouteProgress } from './components/RouteProgress'
import { ErrorBoundary } from './components/ErrorBoundary'
import { MongoAlerts, MongoPulse } from './components/MongoStatus'
import { useMongoStatus } from './useMongoStatus'
import { Pending } from './components/Spinner'
import { PluginPage } from './components/PluginPage'
import { HookStatusPanel } from './components/HookStatusPanel'
import { DeleteInactiveWorktrees } from './components/DeleteInactiveWorktrees'

const HistoryPage = lazy(() => import('./components/HistoryPage').then((m) => ({ default: m.HistoryPage })))
const SetupPage = lazy(() => import('./components/SetupPage').then((m) => ({ default: m.SetupPage })))
const VaultPage = lazy(() => import('./components/VaultPage').then((m) => ({ default: m.VaultPage })))

type View = 'home' | 'history' | 'vault' | 'hooks' | 'plugin' | 'setup'

const VIEW_PATHS: Record<View, string> = { home: '/', history: '/history', vault: '/vault', hooks: '/hooks', plugin: '/plugin', setup: '/setup' }

function viewFromPath(pathname: string): View {
  const entry = Object.entries(VIEW_PATHS).find(([, p]) => p !== '/' && (pathname === p || pathname.startsWith(`${p}/`)))
  return (entry?.[0] as View | undefined) ?? 'home'
}

function NavButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
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

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {count !== undefined && (
        <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">{count}</span>
      )}
      <div className="flex-1 border-t border-slate-800/60" />
    </div>
  )
}

export default function App() {
  const [view, setViewState] = useState<View>(() => viewFromPath(window.location.pathname))
  const [data, setData] = useState<GraphResponse | null>(null)
  const [online, setOnline] = useState(true)
  const [expandedRepos, setExpandedRepos] = useState<string[]>([])
  const [modalRepo, setModalRepo] = useState<Repo | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [setupKey, setSetupKey] = useState(0)
  const mongo = useMongoStatus()

  const setView = useCallback((next: View) => {
    if (VIEW_PATHS[next] !== window.location.pathname) window.history.pushState(null, '', VIEW_PATHS[next])
    setViewState(next)
  }, [])

  useEffect(() => {
    api
      .setupStatus()
      .then((st) => {
        if (!st.onboarded || st.missing.some((m) => m === 'mongo' || m === 'repos' || m === 'profile')) setWizardOpen(true)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const onPop = () => setViewState(viewFromPath(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const poll = useCallback(async () => {
    try {
      const j = await api.graph(expandedRepos)
      setData(j)
      setOnline(true)
    } catch {
      setOnline(false)
    }
  }, [expandedRepos])

  usePolling(poll, POLL_MS, poll)

  const onRepoClick = useCallback(
    (repoPath: string) => {
      const repo = data?.state.repos.find((r) => r.path === repoPath)
      if (repo) setModalRepo(repo)
    },
    [data]
  )

  const onExpandRepo = useCallback((repoId: string) => {
    setExpandedRepos((prev) => (prev.includes(repoId) ? prev : [...prev, repoId]))
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900">
      <RouteProgress view={view} />
      <div className="mx-auto max-w-[1400px] px-6 py-6">
        <header className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-white">Agent Dashboard</h1>
              <p className="mt-1 text-sm text-slate-400">Browse, monitor, and control your AI coding sessions</p>
            </div>
            <div className="flex items-center gap-4">
              <MongoPulse status={mongo} />
              <nav className="flex gap-1 rounded-xl border border-slate-800 bg-slate-900/80 p-1">
                <NavButton active={view === 'home'} onClick={() => setView('home')}>
                  Home
                </NavButton>
                <NavButton active={view === 'history'} onClick={() => setView('history')}>
                  History
                </NavButton>
                <NavButton active={view === 'vault'} onClick={() => setView('vault')}>
                  Vault
                </NavButton>
                <NavButton active={view === 'hooks'} onClick={() => setView('hooks')}>
                  Hooks
                </NavButton>
                <NavButton active={view === 'plugin'} onClick={() => setView('plugin')}>
                  Plugin
                </NavButton>
                <NavButton active={view === 'setup'} onClick={() => setView('setup')}>
                  Setup
                </NavButton>
              </nav>
            </div>
          </div>
          {view === 'home' && <div className="mt-4">{data && <StatBar state={data.state} />}</div>}
        </header>

        <MongoAlerts status={mongo} hidePopup={view === 'setup' || wizardOpen} />
        <ErrorBoundary key={view}>
          <Suspense fallback={<Pending />}>
          {view === 'history' ? (
            <HistoryPage />
          ) : view === 'vault' ? (
            <VaultPage />
          ) : view === 'setup' ? (
            <SetupPage key={setupKey} onRunGuide={() => setWizardOpen(true)} />
          ) : view === 'plugin' ? (
            <PluginPage />
          ) : view === 'hooks' ? (
            <div className="max-w-3xl">
              <SectionHeader title="Hooks" />
              <HookStatusPanel />
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
              <section>
                <div className="mb-2 flex items-center gap-2 text-sm text-slate-400">
                  <span className={`inline-block w-2 h-2 rounded-full ${online ? 'bg-ok animate-pulse' : 'bg-danger'}`} />
                  {data ? `updated ${data.ts}` : 'loading…'}
                  <span className="text-slate-600">— click a repo node for a new session</span>
                  {data && (
                    <span className="ml-auto">
                      <DeleteInactiveWorktrees state={data.state} onChange={poll} />
                    </span>
                  )}
                </div>
                {data && <MermaidGraph definition={data.mermaid} onRepoClick={onRepoClick} onExpandRepo={onExpandRepo} />}
              </section>

              <aside className="space-y-5">
                <div>
                  <SectionHeader title="cmux tabs" count={data?.state.tabs.length} />
                  {data && <TabList tabs={data.state.tabs} />}
                </div>
                <div>
                  <SectionHeader title="Bare agent processes" count={data?.state.agents.length} />
                  {data && <AgentList agents={data.state.agents} onChange={poll} />}
                </div>
                <div>
                  <SectionHeader
                    title="Worktrees"
                    count={data?.state.repos.reduce((n, r) => n + r.worktrees.filter((wt) => !wt.isMain).length, 0)}
                  />
                  {data && <WorktreeList state={data.state} onChange={poll} />}
                </div>
              </aside>
            </div>
          )}
          {wizardOpen && (
            <SetupPage
              wizard
              onClose={() => {
                setWizardOpen(false)
                setSetupKey((k) => k + 1)
              }}
            />
          )}
          </Suspense>
        </ErrorBoundary>
      </div>

      {modalRepo && <NewSessionModal repo={modalRepo} onClose={() => setModalRepo(null)} onCreated={poll} />}
    </div>
  )
}
