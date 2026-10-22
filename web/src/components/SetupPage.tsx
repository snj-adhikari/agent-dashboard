import { createContext, useCallback, useContext, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { api } from '../api'
import type { BaseBranchRule, HooksConfig, ServiceSettings, Settings, SetupStatus, SetupStep } from '../types'
import { Button, Card } from './Card'
import { Modal } from './Modal'
import { Pending } from './Spinner'
import { CmuxSocketGuide, CMUX_SECRET } from './CmuxSocketGuide'
import { WizardShell, WIZARD_STEPS, type WizardStepId } from './OnboardingWizard'
import { ChipList, CopyLine, Field, fromRows, RowsEditor, TextInput, toRows } from './SetupFields'

const DEFAULT_HOOKS: HooksConfig = {
  pollModel: 'claude-sonnet-5',
  completion: 'approve',
  maxConcurrent: 1,
  gate: { fiveHourPct: 50, sevenDayPct: 95 },
  jiraProjects: [],
  projectRepos: {},
  repositoryField: {},
  repoDescriptions: {},
  baseBranches: [],
  allowedGithubOrgs: []
}

const clean = (l: string[]) => l.map((x) => x.trim()).filter(Boolean)

const withDefaults = (s: Partial<Settings>, d: ServiceSettings): Settings => ({
  repoDirs: s.repoDirs ?? [],
  terminal: s.terminal ?? 'auto',
  terminalOpenWindow: s.terminalOpenWindow ?? true,
  vaultPath: s.vaultPath ?? '',
  usageStatePath: s.usageStatePath ?? '',
  profile: { displayName: '', githubHandle: '', createPrSkill: '', prReviewSkill: '', ...s.profile },
  atlassian: { siteUrl: '', repositoryFieldId: '', workIssueTypes: [], subtaskIssueType: '', extraInstructions: '', ...s.atlassian },
  hooks: { ...DEFAULT_HOOKS, ...s.hooks, gate: { ...DEFAULT_HOOKS.gate, ...s.hooks?.gate } },
  service: {
    label: s.service?.label || d.label,
    nodePath: s.service?.nodePath || d.nodePath,
    repoPath: s.service?.repoPath || d.repoPath,
    logPath: s.service?.logPath || d.logPath,
    errLogPath: s.service?.errLogPath || d.errLogPath,
    pathEnv: s.service?.pathEnv || d.pathEnv,
    secretEnvNames: s.service?.secretEnvNames ?? []
  },
  blocker: { name: 'GTA - Blocker', sites: [], ...s.blocker },
  completedSteps: s.completedSteps ?? []
})

const MONGO_COMMANDS = [
  'brew services start mongodb-community',
  'sudo systemctl start mongod',
  'docker run -d --name mongo -p 27017:27017 mongo:7'
]

type SaveFn = () => Promise<boolean> | void

const WizardCtx = createContext<{ only: WizardStepId; saveRef: MutableRefObject<SaveFn | undefined> } | null>(null)

function Section({
  id,
  title,
  done,
  children,
  onSave,
  saving,
  saved
}: {
  id: WizardStepId
  title: string
  done: boolean
  children: ReactNode
  onSave?: SaveFn
  saving?: boolean
  saved?: string
}) {
  const wizard = useContext(WizardCtx)
  if (wizard) {
    if (wizard.only !== id) return null
    wizard.saveRef.current = onSave
    return <Card>{children}</Card>
  }
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${done ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
          {done ? 'done' : 'to do'}
        </span>
        <div className="flex-1 border-t border-slate-800/60" />
      </div>
      <Card>
        {children}
        {onSave && (
          <div className="mt-1 flex items-center gap-2">
            <Button primary loading={saving} onClick={onSave}>
              Save
            </Button>
            {saved && <span className="text-[11px] text-slate-400">{saved}</span>}
          </div>
        )}
      </Card>
    </section>
  )
}

const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v.trim() !== '' ? Number(v) : fallback)

export function SetupPage({ wizard, onClose, onRunGuide }: { wizard?: boolean; onClose?: () => void; onRunGuide?: () => void }) {
  const [s, setS] = useState<Settings | null>(null)
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<Record<string, string>>({})
  const [dirChecks, setDirChecks] = useState<Record<string, string>>({})
  const [mongoMsg, setMongoMsg] = useState('')
  const [service, setService] = useState<{ path: string; plist: string; commands: string[]; note?: string } | null>(null)
  const [confirmInstall, setConfirmInstall] = useState(false)
  const [cmuxToken, setCmuxToken] = useState('')
  const [stepIdx, setStepIdx] = useState(0)
  const saveRef = useRef<SaveFn | undefined>(undefined)

  const refreshStatus = useCallback(() => api.setupStatus().then(setStatus), [])

  const load = useCallback(async () => {
    try {
      const [settings, st] = await Promise.all([api.settings(), api.setupStatus()])
      setStatus(st)
      setS(withDefaults(settings, st.serviceDefaults))
      if (wizard && !st.mongo.up) setStepIdx(1)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [refreshStatus])

  useEffect(() => {
    load()
  }, [load])

  if (error) return <div className="text-sm text-rose-400">Could not load settings: {error}</div>
  if (!s || !status) return <Pending />

  const up = status.mongo.up
  const missing = (step: SetupStep) => status.missing.includes(step)
  const upd = (patch: Partial<Settings>) => setS({ ...s, ...patch })
  const updHooks = (patch: Partial<HooksConfig>) => upd({ hooks: { ...s.hooks, ...patch } })

  async function save(step: SetupStep, patch: Partial<Settings>, markDone = true): Promise<boolean> {
    setBusy(step)
    const completedSteps = markDone ? [...new Set([...s!.completedSteps, step])] : s!.completedSteps
    try {
      const r = await api.saveSettings({ ...patch, completedSteps })
      if (r.ok) {
        setS((cur) => cur && { ...cur, completedSteps })
        await refreshStatus()
      }
      setMsg((m) => ({ ...m, [step]: r.ok ? 'Saved' : (r.error ?? 'Save failed') }))
      setBusy(null)
      return r.ok
    } catch (e) {
      setMsg((m) => ({ ...m, [step]: (e as Error).message }))
    }
    setBusy(null)
    return false
  }

  async function checkDir(path: string) {
    const r = await api.checkDir(path)
    const text = !r.ok ? (r.error ?? 'Check failed') : !r.exists ? 'Folder not found' : `${r.repoCount} repo${r.repoCount === 1 ? '' : 's'} found`
    setDirChecks((c) => ({ ...c, [path]: text }))
  }

  async function startMongo() {
    setBusy('mongo')
    const r = await api.restartMongo()
    setMongoMsg(r.ok ? 'Start requested' : (r.error ?? 'Could not start MongoDB'))
    await refreshStatus()
    setBusy(null)
  }

  async function generate() {
    setBusy('generate')
    const r = await api.generateService(s!.service, cmuxToken ? { [CMUX_SECRET]: cmuxToken } : undefined)
    if (r.ok) setService({ path: r.path, plist: r.plist, commands: r.commands, note: r.note })
    setMsg((m) => ({ ...m, service: r.ok ? '' : (r.error ?? 'Generate failed') }))
    setBusy(null)
  }

  async function install() {
    setConfirmInstall(false)
    setBusy('install')
    const r = await api.installService(cmuxToken ? { [CMUX_SECRET]: cmuxToken } : undefined)
    setMsg((m) => ({ ...m, service: r.ok ? 'Installed' + (r.output ? `: ${r.output}` : '') : (r.error ?? 'Install failed') }))
    setBusy(null)
  }

  const saved = (k: string) => (busy === k ? 'Saving...' : msg[k])
  const baseRows = s.hooks.baseBranches.map((b) => [b.repo, b.titleMatch ?? '', b.base])

  const content = (
    <div className="max-w-3xl">
      {onRunGuide && (
        <div className="mb-4">
          <Button onClick={onRunGuide}>Run setup guide again</Button>
        </div>
      )}
      <Section id="mongo" title="MongoDB" done={up}>
        <div className="mb-2 flex items-center gap-2 text-sm">
          <span className={`inline-block h-2 w-2 rounded-full ${up ? 'bg-ok' : 'bg-danger'}`} />
          {up ? 'MongoDB is reachable.' : 'MongoDB is not reachable. Start it, then check again.'}
        </div>
        {!up && (
          <>
            {status.mongo.error && <div className="mb-2 break-words font-mono text-[11px] text-red-300">{status.mongo.error}</div>}
            <p className="mb-1 text-[11px] text-slate-400">Pick whichever matches how you run MongoDB:</p>
            {MONGO_COMMANDS.map((c) => (
              <CopyLine key={c} text={c} />
            ))}
            <p className="mb-2 mt-1 text-[11px] text-slate-500">
              Using a remote or non-default server? Set MONGO_URL in .env and restart the monitor.
            </p>
          </>
        )}
        <Button loading={busy === 'check'} onClick={async () => { setBusy('check'); await refreshStatus(); setBusy(null) }}>
          Check again
        </Button>
        {!up && (
          <Button primary loading={busy === 'mongo'} onClick={startMongo}>
            Start it
          </Button>
        )}
        {mongoMsg && !up && <span className="text-[11px] text-slate-400">{mongoMsg}</span>}
      </Section>

      <fieldset disabled={!up} className={`min-w-0 border-0 p-0 ${up ? '' : 'pointer-events-none opacity-50'}`}>
        <Section
          id="repos"
          title="Repo folders"
          done={!missing('repos')}
          onSave={() => save('repos', { repoDirs: clean(s.repoDirs) })}
          saving={busy === 'repos'}
          saved={saved('repos')}
        >
          <p className="mb-2 text-[11px] text-slate-500">Folders that contain your git repos. Each is scanned one level deep.</p>
          <RowsEditor
            columns={['Folder path']}
            rows={s.repoDirs.map((d) => [d])}
            onChange={(rows) => upd({ repoDirs: rows.map((r) => r[0]) })}
            after={(row) => (
              <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                <button type="button" disabled={!row[0]?.trim()} onClick={() => checkDir(row[0].trim())} className="text-sky-300 hover:underline disabled:opacity-40">
                  Check folder
                </button>
                {dirChecks[row[0]?.trim()]}
              </div>
            )}
          />
        </Section>

        <Section
          id="profile"
          title="Profile"
          done={!missing('profile')}
          onSave={() => save('profile', { profile: s.profile, terminal: s.terminal, terminalOpenWindow: s.terminalOpenWindow })}
          saving={busy === 'profile'}
          saved={saved('profile')}
        >
          <Field label="Display name">
            <TextInput value={s.profile.displayName} onChange={(v) => upd({ profile: { ...s.profile, displayName: v } })} placeholder="Your name" />
          </Field>
          <Field label="GitHub handle">
            <TextInput value={s.profile.githubHandle} onChange={(v) => upd({ profile: { ...s.profile, githubHandle: v } })} placeholder="octocat" />
          </Field>
          <Field label="Create-PR skill" hint="Optional. Skill name hooks invoke to open a PR.">
            <TextInput value={s.profile.createPrSkill} onChange={(v) => upd({ profile: { ...s.profile, createPrSkill: v } })} />
          </Field>
          <Field label="PR review skill" hint="Optional. Skill name hooks invoke to review a PR.">
            <TextInput value={s.profile.prReviewSkill} onChange={(v) => upd({ profile: { ...s.profile, prReviewSkill: v } })} />
          </Field>
          <Field label="Terminal" hint={status ? `Active: ${status.terminal.backend}. Auto uses cmux, then tmux, then Terminal.app (open only).` : undefined}>
            <select
              value={s.terminal}
              onChange={(e) => upd({ terminal: e.target.value as Settings['terminal'] })}
              className="w-full box-border rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-brand"
            >
              <option value="auto">auto</option>
              <option value="cmux">cmux</option>
              <option value="tmux">tmux</option>
              <option value="terminal">terminal (Terminal.app, open only)</option>
            </select>
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={s.terminalOpenWindow} onChange={(e) => upd({ terminalOpenWindow: e.target.checked })} />
            Open a Terminal window for new tmux sessions (macOS)
          </label>
        </Section>

        <Section
          id="vault"
          title="Vault"
          done={!missing('vault')}
          onSave={() => save('vault', { vaultPath: s.vaultPath })}
          saving={busy === 'vault'}
          saved={saved('vault')}
        >
          <Field label="Vault folder" hint="Optional. An Obsidian vault or any folder of markdown notes. Leave blank to hide the Vault tab.">
            <TextInput value={s.vaultPath} onChange={(v) => upd({ vaultPath: v })} placeholder="/path/to/vault" />
          </Field>
        </Section>

        <Section
          id="atlassian"
          title="Atlassian and hooks"
          done={!missing('atlassian')}
          onSave={() =>
            save('atlassian', {
              atlassian: { ...s.atlassian, workIssueTypes: clean(s.atlassian.workIssueTypes) },
              hooks: { ...s.hooks, jiraProjects: clean(s.hooks.jiraProjects), allowedGithubOrgs: clean(s.hooks.allowedGithubOrgs) },
              usageStatePath: s.usageStatePath
            })
          }
          saving={busy === 'atlassian'}
          saved={saved('atlassian')}
        >
          <Field label="Atlassian site URL">
            <TextInput value={s.atlassian.siteUrl} onChange={(v) => upd({ atlassian: { ...s.atlassian, siteUrl: v } })} placeholder="https://example.atlassian.net" />
          </Field>
          <Field label="Repository field id" hint="Jira custom field used to record the repo.">
            <TextInput value={s.atlassian.repositoryFieldId} onChange={(v) => upd({ atlassian: { ...s.atlassian, repositoryFieldId: v } })} placeholder="customfield_12345" />
          </Field>
          <Field label="Work issue types">
            <ChipList value={s.atlassian.workIssueTypes} onChange={(v) => upd({ atlassian: { ...s.atlassian, workIssueTypes: v } })} />
          </Field>
          <Field label="Subtask issue type">
            <TextInput value={s.atlassian.subtaskIssueType} onChange={(v) => upd({ atlassian: { ...s.atlassian, subtaskIssueType: v } })} />
          </Field>
          <Field label="Extra instructions" hint="Appended to the Jira hook prompt.">
            <textarea
              rows={4}
              value={s.atlassian.extraInstructions}
              onChange={(e) => upd({ atlassian: { ...s.atlassian, extraInstructions: e.target.value } })}
              className="w-full box-border rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-brand"
            />
          </Field>
          <Field label="Usage state file" hint="Optional. JSON with five_hour and seven_day used_percentage; hooks pause above the limits below. Blank skips the gate.">
            <TextInput value={s.usageStatePath} onChange={(v) => upd({ usageStatePath: v })} placeholder="/path/to/usage-state.json" />
          </Field>
          <Field label="Poll model">
            <TextInput value={s.hooks.pollModel} onChange={(v) => updHooks({ pollModel: v })} />
          </Field>
          <Field label="Completion">
            <select
              value={s.hooks.completion}
              onChange={(e) => updHooks({ completion: e.target.value as HooksConfig['completion'] })}
              className="w-full box-border rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-brand"
            >
              <option value="approve">approve</option>
              <option value="draft-pr">draft-pr</option>
            </select>
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Max concurrent">
              <TextInput type="number" value={s.hooks.maxConcurrent} onChange={(v) => updHooks({ maxConcurrent: num(v, s.hooks.maxConcurrent) })} />
            </Field>
            <Field label="5-hour limit %">
              <TextInput type="number" value={s.hooks.gate.fiveHourPct} onChange={(v) => updHooks({ gate: { ...s.hooks.gate, fiveHourPct: num(v, s.hooks.gate.fiveHourPct) } })} />
            </Field>
            <Field label="7-day limit %">
              <TextInput type="number" value={s.hooks.gate.sevenDayPct} onChange={(v) => updHooks({ gate: { ...s.hooks.gate, sevenDayPct: num(v, s.hooks.gate.sevenDayPct) } })} />
            </Field>
          </div>
          <Field label="Jira projects">
            <ChipList value={s.hooks.jiraProjects} onChange={(v) => updHooks({ jiraProjects: v })} placeholder="PROJ" />
          </Field>
          <Field label="Allowed GitHub orgs">
            <ChipList value={s.hooks.allowedGithubOrgs} onChange={(v) => updHooks({ allowedGithubOrgs: v })} />
          </Field>
          <Field label="Project to repo">
            <RowsEditor columns={['Jira project', 'Repo']} rows={toRows(s.hooks.projectRepos)} onChange={(r) => updHooks({ projectRepos: fromRows(r) })} />
          </Field>
          <Field label="Repository field values">
            <RowsEditor columns={['Repo', 'Field value']} rows={toRows(s.hooks.repositoryField)} onChange={(r) => updHooks({ repositoryField: fromRows(r) })} />
          </Field>
          <Field label="Repo descriptions">
            <RowsEditor columns={['Repo', 'Description']} rows={toRows(s.hooks.repoDescriptions)} onChange={(r) => updHooks({ repoDescriptions: fromRows(r) })} />
          </Field>
          <Field label="Base branches" hint="Title match is optional.">
            <RowsEditor
              columns={['Repo', 'Title match', 'Base branch']}
              rows={baseRows}
              onChange={(rows) =>
                updHooks({
                  baseBranches: rows
                    .filter((r) => r[0]?.trim() || r[2]?.trim())
                    .map((r): BaseBranchRule => ({ repo: r[0].trim(), ...(r[1]?.trim() ? { titleMatch: r[1].trim() } : {}), base: (r[2] ?? '').trim() }))
                })
              }
            />
          </Field>
        </Section>

        <Section
          id="service"
          title="Background service"
          done={!missing('service')}
          onSave={() => save('service', { service: { ...s.service, secretEnvNames: clean(s.service.secretEnvNames) } })}
          saving={busy === 'service'}
          saved={saved('service')}
        >
          <p className="mb-2 text-[11px] text-slate-500">Optional. Keeps the monitor running at login (macOS LaunchAgent). Save your fields first, then generate.</p>
          <Field label="Label">
            <TextInput value={s.service.label} onChange={(v) => upd({ service: { ...s.service, label: v } })} placeholder="com.example.agent-monitor" />
          </Field>
          <Field label="Node path">
            <TextInput value={s.service.nodePath} onChange={(v) => upd({ service: { ...s.service, nodePath: v } })} />
          </Field>
          <Field label="Repo path">
            <TextInput value={s.service.repoPath} onChange={(v) => upd({ service: { ...s.service, repoPath: v } })} />
          </Field>
          <Field label="Log path">
            <TextInput value={s.service.logPath} onChange={(v) => upd({ service: { ...s.service, logPath: v } })} />
          </Field>
          <Field label="Error log path">
            <TextInput value={s.service.errLogPath} onChange={(v) => upd({ service: { ...s.service, errLogPath: v } })} />
          </Field>
          <Field label="PATH">
            <TextInput value={s.service.pathEnv} onChange={(v) => upd({ service: { ...s.service, pathEnv: v } })} />
          </Field>
          <Field label="Secret env names" hint="Names only. Values stay in the plist and are never stored in MongoDB.">
            <ChipList value={s.service.secretEnvNames} onChange={(v) => upd({ service: { ...s.service, secretEnvNames: v } })} />
          </Field>
          <CmuxSocketGuide token={cmuxToken} onChange={setCmuxToken} />
          <div className="mb-2">
            <Button loading={busy === 'generate'} onClick={generate}>
              Generate
            </Button>
            {service && (
              <Button danger loading={busy === 'install'} onClick={() => setConfirmInstall(true)}>
                Install
              </Button>
            )}
          </div>
          {service && (
            <div className="mb-2">
              <div className="mb-1 text-[11px] text-slate-400">Plist: <span className="font-mono">{service.path}</span></div>
              <pre className="mb-2 max-h-64 overflow-auto rounded bg-slate-950 p-2 text-xs text-slate-200">{service.plist}</pre>
              {service.commands.map((c) => (
                <CopyLine key={c} text={c} />
              ))}
              {service.note && <p className="mt-1 text-[11px] text-slate-500">{service.note}</p>}
            </div>
          )}
        </Section>

        <Section
          id="blocker"
          title="Chrome blocker"
          done={!missing('blocker')}
          onSave={() => {
            const sites = clean(s.blocker.sites)
            return save('blocker', { blocker: { ...s.blocker, sites } }, sites.length > 0)
          }}
          saving={busy === 'blocker'}
          saved={saved('blocker')}
        >
          <Field label="Extension name">
            <TextInput value={s.blocker.name} onChange={(v) => upd({ blocker: { ...s.blocker, name: v } })} />
          </Field>
          <Field label="Sites">
            <RowsEditor
              columns={['Domain']}
              rows={s.blocker.sites.map((d) => [d])}
              onChange={(rows) => upd({ blocker: { ...s.blocker, sites: rows.map((r) => r[0]) } })}
            />
          </Field>
          <p className="mb-2 text-[11px] text-slate-500">
            These are written when you add the extension from the Plugin page. Once installed, you can also edit sites on the extension's options page.
          </p>
        </Section>
      </fieldset>

      {confirmInstall && (
        <Modal onClose={() => setConfirmInstall(false)}>
          <div className="mb-2 font-semibold text-slate-100">Install background service?</div>
          <p className="mb-3 text-slate-300">This writes the plist to {service?.path} and loads it with launchctl. An existing service with the same label is restarted.</p>
          <div className="text-right">
            <Button onClick={() => setConfirmInstall(false)}>Cancel</Button>
            <Button primary onClick={install}>
              Install
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )

  if (!wizard) return content

  const step = WIZARD_STEPS[stepIdx]
  const last = stepIdx === WIZARD_STEPS.length - 1
  const nextBlocked =
    (step.id === 'mongo' && !up) ||
    (step.id === 'repos' && clean(s.repoDirs).length === 0) ||
    (step.id === 'profile' && !s.profile.displayName.trim())

  async function next() {
    if (last) {
      setBusy('finish')
      const r = await api.saveSettings({ onboardedAt: new Date().toISOString() })
      setBusy(null)
      if (r.ok) onClose?.()
      else setMsg((m) => ({ ...m, finish: r.error ?? 'Could not finish' }))
      return
    }
    const ok = step.sectioned ? (await saveRef.current?.()) !== false : true
    if (ok) setStepIdx(stepIdx + 1)
  }

  return (
    <WizardShell
      index={stepIdx}
      busy={!!busy}
      nextBlocked={nextBlocked}
      error={step.sectioned ? msg[step.id] && msg[step.id] !== 'Saved' ? msg[step.id] : '' : msg.finish}
      onBack={() => setStepIdx(stepIdx - 1)}
      onNext={next}
      onSkip={() => setStepIdx(stepIdx + 1)}
      onExit={() => onClose?.()}
    >
      {step.sectioned ? <WizardCtx.Provider value={{ only: step.id, saveRef }}>{content}</WizardCtx.Provider> : null}
    </WizardShell>
  )
}
