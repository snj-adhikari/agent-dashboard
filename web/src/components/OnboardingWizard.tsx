import type { ReactNode } from 'react'
import { Button } from './Card'

export const WIZARD_STEPS = [
  { id: 'welcome', title: 'Welcome', sectioned: false, optional: false },
  { id: 'mongo', title: 'MongoDB', sectioned: true, optional: false },
  { id: 'repos', title: 'Repo folders', sectioned: true, optional: false },
  { id: 'profile', title: 'Profile and terminal', sectioned: true, optional: false },
  { id: 'vault', title: 'Vault', sectioned: true, optional: true },
  { id: 'atlassian', title: 'Atlassian and hooks', sectioned: true, optional: true },
  { id: 'service', title: 'Background service and cmux', sectioned: true, optional: true },
  { id: 'blocker', title: 'Chrome blocker', sectioned: true, optional: true },
  { id: 'tour', title: 'Tour', sectioned: false, optional: false },
  { id: 'finish', title: 'Finish', sectioned: false, optional: false }
] as const

export type WizardStepId = (typeof WIZARD_STEPS)[number]['id']

const WELCOME = [
  'See every git worktree, terminal tab and agent CLI process across your repo folders in one place.',
  'Start, message and clean up agent sessions without leaving the dashboard.',
  'Optional automation hooks turn assigned Jira tickets and PR review requests into ready sessions.'
]

const TOUR: [string, string][] = [
  ['Home', 'Live graph of repos, worktrees, terminal tabs and agents, with controls for each.'],
  ['History', 'Usage and session history over time, with links back to open tabs.'],
  ['Vault', 'Browse your notes folder as a tree and graph.'],
  ['Hooks', 'Status of the automation queue and the usage gate.'],
  ['Plugin', 'Download or import the Claude plugin and Chrome extension.'],
  ['Setup', 'Edit any of these settings later, or run this guide again.']
]

function Body({ id }: { id: WizardStepId }) {
  if (id === 'welcome') {
    return (
      <ul className="list-disc space-y-2 pl-5 text-sm text-slate-300">
        {WELCOME.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    )
  }
  if (id === 'tour') {
    return (
      <dl className="space-y-2 text-sm">
        {TOUR.map(([name, line]) => (
          <div key={name} className="flex gap-3">
            <dt className="w-20 shrink-0 font-medium text-slate-100">{name}</dt>
            <dd className="text-slate-400">{line}</dd>
          </div>
        ))}
      </dl>
    )
  }
  return <p className="text-sm text-slate-300">You are all set. Finish to open the dashboard; everything here can be changed later on the Setup page.</p>
}

export function WizardShell({
  index,
  busy,
  nextBlocked,
  error,
  onBack,
  onNext,
  onSkip,
  onExit,
  children
}: {
  index: number
  busy: boolean
  nextBlocked: boolean
  error?: string
  onBack: () => void
  onNext: () => void
  onSkip: () => void
  onExit: () => void
  children: ReactNode
}) {
  const step = WIZARD_STEPS[index]
  const last = index === WIZARD_STEPS.length - 1
  return (
    <div role="dialog" aria-label="Welcome to Agent Dashboard" className="fixed inset-0 z-50 overflow-auto bg-slate-950">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-1 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Welcome to Agent Dashboard</h1>
          <button type="button" onClick={onExit} className="text-xs text-slate-500 hover:text-slate-300">
            Exit guide
          </button>
        </div>
        <div className="mb-1 mt-3 flex gap-1" aria-label={`Step ${index + 1} of ${WIZARD_STEPS.length}`}>
          {WIZARD_STEPS.map((s, i) => (
            <div key={s.id} className={`h-1 flex-1 rounded-full ${i <= index ? 'bg-brand' : 'bg-slate-800'}`} />
          ))}
        </div>
        <div className="mb-4 text-[11px] text-slate-500">
          Step {index + 1} of {WIZARD_STEPS.length}: {step.title}
          {step.optional && ' (optional)'}
        </div>
        <div className="mb-4">{step.sectioned ? children : <Body id={step.id} />}</div>
        {error && <div className="mb-2 text-[11px] text-red-300">{error}</div>}
        <div className="flex items-center gap-2">
          <Button onClick={onBack} disabled={index === 0 || busy}>
            Back
          </Button>
          {step.optional && <Button onClick={onSkip} disabled={busy}>Skip</Button>}
          <Button primary loading={busy} disabled={nextBlocked} onClick={onNext}>
            {last ? 'Finish' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  )
}
