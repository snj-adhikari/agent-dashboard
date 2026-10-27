import { useEffect, useState } from 'react'
import { api } from '../api'
import { Card } from './Card'

interface Plugin {
  name: string
  kind: 'mod' | 'chrome'
  title?: string
  blurb: string
  steps: { title: string; code: string }[]
}

const PLUGINS: Plugin[] = [
  {
    name: 'agent-monitor-hook',
    kind: 'mod',
    blurb:
      "Shows the hook ticket and phase in a Claude Code session's status line and reports every interactive session (pid, cwd, phase) back to this monitor.",
    steps: [
      { title: 'Install from the marketplace', code: '/plugin install agent-monitor-hook --marketplace snj-adhikari/agent-dashboard' },
      { title: 'Or run the downloaded zip for one session', code: 'unzip agent-monitor-hook.zip -d agent-monitor-hook && claude --plugin-dir ./agent-monitor-hook' },
      { title: 'Optional: report to a different monitor', code: 'export AGENT_MONITOR_URL=http://localhost:5818' }
    ]
  },
  {
    name: 'agent-sessions',
    kind: 'mod',
    blurb: 'Adds /agent-sessions to any Claude Code session: a terminal tree of every Claude session and the worktree it is working in.',
    steps: [
      { title: 'Install from the marketplace', code: '/plugin install agent-sessions --marketplace snj-adhikari/agent-dashboard' },
      { title: 'Or run the downloaded zip for one session', code: 'unzip agent-sessions.zip -d agent-sessions && claude --plugin-dir ./agent-sessions' },
      { title: 'Then, in any session', code: '/agent-sessions' }
    ]
  },
  {
    name: 'stop-slop',
    kind: 'mod',
    blurb: 'Makes every session write like a person: short bullets, first person, no AI tells. Specs and plans are left alone. Works without the monitor.',
    steps: [
      { title: 'Install from the marketplace', code: '/plugin install stop-slop --marketplace snj-adhikari/agent-dashboard' },
      { title: 'Or run the downloaded zip for one session', code: 'unzip stop-slop.zip -d stop-slop && claude --plugin-dir ./stop-slop' }
    ]
  },
  {
    name: 'factory',
    kind: 'mod',
    blurb: 'Adds /factory <goal>: a lead agent grills you one question at a time, then runs on its own, driving research, plan, dev and QA agents in a self-running loop until the goal is met. Blocks git commit and push unless you ask.',
    steps: [
      { title: 'Install from the marketplace', code: '/plugin install factory --marketplace snj-adhikari/agent-dashboard' },
      { title: 'Or run the downloaded zip for one session', code: 'unzip factory.zip -d factory && claude --plugin-dir ./factory --model opus' },
      { title: 'Then, in any session', code: '/factory <goal>' }
    ]
  },
  {
    name: 'agent-kit',
    kind: 'mod',
    blurb: 'Skills for agent work: a controller that runs agents across several repos, one tab and worktree each (cmux, herdr, tmux, zellij, WezTerm), a new worktree in its own cmux tab, PR descriptions built from the repo template, Artifact page layouts, threaded Jira replies and starting this dashboard.',
    steps: [
      { title: 'Install from the marketplace', code: '/plugin install agent-kit --marketplace snj-adhikari/agent-dashboard' },
      { title: 'Or run the downloaded zip for one session', code: 'unzip agent-kit.zip -d agent-kit && claude --plugin-dir ./agent-kit' },
      { title: 'Then, in any session', code: 'work on ABC-123 in a new worktree' }
    ]
  }
]

function ImportButton({ name, kind }: { name: string; kind: Plugin['kind'] }) {
  const [state, setState] = useState<{ busy?: boolean; msg?: string; ok?: boolean }>({})
  const run = async () => {
    setState({ busy: true })
    try {
      const r = await api.importPlugin(name)
      const done =
        kind === 'chrome'
          ? `Copied to ${r.path} (path is on your clipboard). In the chrome://extensions tab: Developer mode on, Load unpacked, Cmd+Shift+G, paste. Already loaded? Press its reload icon. Edit blocked sites later on the extension's options page.`
          : `Added to ${r.path}. New sessions load it; restart open ones.`
      setState(r.ok ? { ok: true, msg: done } : { msg: r.error })
    } catch (e) {
      setState({ msg: (e as Error).message })
    }
  }
  return (
    <>
      <button
        onClick={run}
        disabled={state.busy}
        className="rounded-lg bg-emerald-700 px-3.5 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {state.busy ? 'Adding...' : 'Add to this device'}
      </button>
      {state.msg && <p className={`w-full text-xs ${state.ok ? 'text-emerald-400' : 'text-rose-400'}`}>{state.msg}</p>}
    </>
  )
}

const BLOCKER = 'njw-analytic-blocker'

function blockerPlugin(name: string, sites: string[]): Plugin {
  return {
    name: BLOCKER,
    kind: 'chrome',
    title: name,
    blurb: `Chrome extension that blocks analytics, tag manager, ad and tracking requests on the sites you choose${sites.length ? ` (${sites.join(', ')})` : ''}. Set sites in Setup or on the extension's options page. Chrome extension, not a session plugin.`,
    steps: [{ title: 'Or install the zip', code: `unzip ${BLOCKER}.zip -d ${BLOCKER}\nchrome://extensions -> Developer mode -> Load unpacked -> ${BLOCKER}` }]
  }
}

function Column({ title, items }: { title: string; items: Plugin[] }) {
  return (
    <div className="min-w-0 space-y-8">
      <h2 className="border-b border-slate-800 pb-2 text-sm font-semibold text-slate-400">{title}</h2>
      {items.map((p) => (
        <section key={p.name}>
          <h3 className="mb-1 text-lg font-semibold text-white">{p.title ?? `${p.name} plugin`}</h3>
          <p className="mb-3 text-sm text-slate-400">{p.blurb}</p>
          <div className="flex flex-wrap items-center gap-2">
            <ImportButton name={p.name} kind={p.kind} />
            <a
              href={`/api/plugin/download?name=${p.name}`}
              className="inline-block rounded-lg bg-brand-dark px-3.5 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              Download {p.name}.zip
            </a>
          </div>
          <div className="mt-4 space-y-3">
            {p.steps.map((s) => (
              <Card key={s.title} accent="blue">
                <div className="text-[11px] font-medium text-slate-300">{s.title}</div>
                <pre className="mt-1 overflow-x-auto rounded bg-slate-950 p-2 text-xs text-slate-200">{s.code}</pre>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export function PluginPage() {
  const [blocker, setBlocker] = useState<Plugin>(blockerPlugin('GTA - Blocker', []))
  useEffect(() => {
    api
      .settings()
      .then((s) => setBlocker(blockerPlugin(s.blocker?.name || 'GTA - Blocker', s.blocker?.sites ?? [])))
      .catch(() => {})
  }, [])
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <Column title="Mod - Claude plugin" items={PLUGINS.filter((p) => p.kind === 'mod')} />
      <Column title="Chrome - Extensions" items={[blocker]} />
    </div>
  )
}
