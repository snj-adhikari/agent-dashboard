import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { FactoryRun, OfficeStatus } from '../types'
import { hcDevs, leadOf, mergeAgents, writeAtomic } from './office'

const run = atom({ plugin: 'factory', key: 'run' } as const, null as FactoryRun)
const reportTo = atom({ plugin: 'factory', key: 'reportTo' } as const, null as string | null)
// ponytail: fixed round cap, make it a userConfig option if runs need longer
const MAX_ROUNDS = 30
const GIT_WRITE = /\bgit\s+(commit|push)\b/
const APPROVED = /\b(commit|push)\b/i
const NEGATED = /\b(don'?t|do not|never|no|without|not yet)\b(\W+\w+){0,3}?\W+(commit|push)\b/i
const RELAYED = /^\s*\[(relay |monitor\]|subtab )/
const HUMAN_ONLY = /HUMAN ONLY:/
const DEV_TAB_CAP = 4

const MAP = `FACTORY - The AI delivery team
You
 └─ Lead (Opus): grills you, plans, verifies, never codes
     ├─ product team      only when requirements are unclear, may prototype with dev
     │   ├─ product-analyst     Sonnet  data to prioritise
     │   ├─ design-lead         Sonnet  project design system
     │   └─ product-consultant  Opus    product frameworks
     ├─ tech-lead         Opus    risks and edge cases, every run
     │   ▲ product and tech lead consult each other via the lead
     ├─ researcher        Haiku/Sonnet/Opus by task, serves product and dev
     ├─ reverse-engineer  Sonnet  when mimicking or inspired by a product, feeds product and tech lead
     ├─ planner           Opus    ai/factory/plan.md
     ├─ developer x N     Sonnet  one task each, tests
     └─ qa                Sonnet  build, lint, screenshots

Flow
  grill me ──ASK──▶ all questions at once, each with a (Recommended) option
     │ reply ok for every recommendation, or 2b, 3: <answer>
     │ until nothing is ambiguous, then runs on its own
  reverse-engineer (if inspired by a product)
     │
  product team (if unclear) ◀──▶ tech lead
     │   └─ prototype with a developer when seeing it helps
     │
  research ──▶ plan
     │
  developers ──▶ qa ──▶ lead checks evidence
     ▲                        │
     └──── gaps: CONTINUE ────┤
                              │ all criteria met
  commit gate ──ASK──▶ you ──▶ DONE

CONTINUE next round · WAIT agents running
ASK your turn · DONE finished
Small, basic tasks run on Haiku
git commit/push blocked unless you say so
${MAX_ROUNDS} rounds max`

export const approved = (prompt: string) => APPROVED.test(prompt) && !NEGATED.test(prompt)

export type FactoryArgs = { goal: string; briefPath?: string; noHerdr: boolean; error?: string }

export function parseArgs(args: string): FactoryArgs {
  const words = args.trim().split(/\s+/).filter(Boolean)
  const rest: string[] = []
  let briefPath: string | undefined
  let noHerdr = false
  for (let i = 0; i < words.length; i++) {
    if (words[i] === '--no-herdr') noHerdr = true
    else if (words[i] === '--brief') {
      briefPath = words[++i]
      if (!briefPath || briefPath.startsWith('--')) return { goal: '', noHerdr, error: 'Usage: /factory --brief <path> [goal]' }
    } else rest.push(words[i])
  }
  return { goal: rest.join(' '), briefPath, noHerdr }
}

export const briefTitle = (text: string) =>
  text.split('\n').map(l => l.replace(/^#+\s*/, '').trim()).find(Boolean) ?? ''

const askFormat = `How to ask (every FACTORY: ASK, the commit gate included): put every open question in ONE ASK, numbered. Each question lists 2-4 lettered options (a, b, c, d); your preferred option comes first, marked (Recommended), with one short reason from what you know (repo, ticket, conventions). End the questions with this line: "Reply \`ok\` to take every recommended option, or e.g. \`2b, 3: <your answer>\` to change some." Reading replies: \`ok\`, \`accept\`, \`defaults\` or \`yes\` takes every recommended option; a reply that answers some numbers takes the recommended option for the rest. Never re-ask a question that was answered or defaulted. Ask a follow-up ASK only when an answer opens a question that could not be known before. Messages starting with \`[agents]\` or \`<hc \` are status pings from other tabs, not answers: while an ASK is open, do not act on them and do not re-ask because of them; keep waiting for the answer. At the commit gate the git guard only accepts a reply that says commit or push, so make the options say it (e.g. "a. commit (Recommended)") and end with: "Reply \`commit\` to take the recommended option, or pick another."`

const grill = `1. Grill me first. Read the goal and the repo, then send ONE FACTORY: ASK with every open question at once (scope, acceptance criteria, repo, branch, environments, what "done" means, what is out of scope), in the format below, and wait for my answer. Keep asking until nothing is ambiguous. Then restate the agreed scope and acceptance criteria as a short list and end with FACTORY: CONTINUE: from here you run on your own without asking me again until the commit gate.`

const grillFromBrief = (path: string) => `1. Read the brief at ${path} first: it is the agreed starting point. List only what it leaves open (scope, acceptance criteria, repo, branch, environments, what "done" means, out of scope) and ask about all of it in ONE FACTORY: ASK, in the format below. If the brief settles everything, ask nothing: restate its scope and acceptance criteria as a short list and end with FACTORY: CONTINUE. Either way, once nothing is ambiguous you run on your own without asking again until the commit gate.`

const whoAnswers = `Who answers: when a report target session is set, your FACTORY: ASK turns go to it. It answers what the brief and its own context settle, and asks the human only when unsure. Some questions are always for the human and the report target never answers them: any scope change, the commit gate, push or PR, and anything posted outside this machine (Jira, Slack, GitHub). Start those questions with HUMAN ONLY: so the report target passes them on verbatim. A message that starts with [relay ...] is never the human's approval for those.`

const agentDevs = `5. Dispatch one factory:developer per independent task, each with isolation: worktree, then factory:qa against the acceptance criteria. Give every agent a time budget (about 20 minutes) and tell it to report what it has when the budget runs out; split QA into small parallel batches. An agent still running well past its budget is stuck: stop it and re-dispatch a smaller task. Pick the model per task: keep each agent's default (Opus for planning, Sonnet for dev and QA), but pass model: haiku for small, basic tasks such as a one-file mechanical change, a rename, a quick lookup or re-running a check.`

const herdrDevs = (session: string) => `5. Developers run in visible herdr tabs. First check \`herdr session list\` shows ${session} as running; if it does not, use Agent-tool developers instead: one factory:developer per independent task with isolation: worktree. In herdr, per independent dev task, with at most ${DEV_TAB_CAP} developer tabs open at once for this ticket (queue the rest and open the next when one closes). Use the ticket key for <KEY> (a short slug of the goal when there is none) and n = 1, 2, 3...:
   a. Run \`~/.claude/hooks/snj/snj-mem-guard.sh check\`; if free RAM is below 12%, queue the task and open nothing. Then pick the tab's codename: if \`~/.claude/hooks/snj/snj-term\` exists, run \`~/.claude/hooks/snj/snj-term codename "$HERDR_SESSION" --seed "<KEY>-dev<n>"\` and take codename from its JSON; the agent name is <key-lower>-<codename>. Without snj-term, or if it fails, there is no codename and the agent name is <key-lower>-dev<n>.
   b. \`git -C <ticket worktree> worktree add -b <ticket-branch>-dev<n> <ticket worktree>-dev<n> <ticket-branch>\`, then write the task brief to \`<ticket worktree>-dev<n>/ai/factory/task.md\`: the files, the acceptance criteria, the tests to run, a time budget (about 20 minutes), the report format (files changed, real test output, open issues) and never commit.
   c. \`herdr tab create --cwd <ticket worktree>-dev<n> --env FACTORY_DEV=1 --label "<KEY> · <codename> · dev <n> · <task>" --no-focus\` (without a codename: "<KEY> · dev <n> · <task>"); keep the tab id and its root pane from its JSON, or from \`herdr pane list\` for that tab. FACTORY_DEV=1 makes the factory git guard deny every git commit and push in that session.
   d. \`herdr agent start <name> --kind claude --pane <pane> -- -n <name>\` with no prompt argument, then \`herdr agent prompt <name> "[relay factory-lead] Read ai/factory/task.md and do it."\`. With a codename, run \`herdr pane report-metadata <pane> --source factory --display-agent <codename> --token codename=<codename>\`.
   Never put brief or follow-up text into a shell command: for a follow-up, append it to that task.md and send the fixed prompt \`herdr agent prompt <name> "[relay factory-lead] Read the latest update at the end of ai/factory/task.md."\`. Every prompt you type into another session starts with [relay factory-lead]. Track each with \`herdr agent wait <name> --until idle --until blocked --timeout <ms>\` and \`herdr agent read <name> --source recent --lines 80\`. herdr tabs do not wake you: poll them and end with FACTORY: CONTINUE, not WAIT, while only herdr developers are running. Stop and re-brief a tab still running well past its budget. QA stays factory:qa via the Agent tool, against the developers' worktrees, in small parallel batches. After QA passes, bring each developer's changes into the ticket worktree (developers never commit, so copy the working tree, not a branch: \`git -C <dev worktree> add -N . && git -C <dev worktree> diff HEAD --binary -- . ':!ai/factory/task.md' | git -C <ticket worktree> apply\`), touching only that task's files, then \`herdr tab close <tab>\`. Leave the developer worktrees for me to clear.`

const hcAppDevs = (lead: string, space: string) => `5. Developers run in visible Herdr app terminals in my space, never focused. Per independent dev task, with at most ${DEV_TAB_CAP} developer terminals open at once for this ticket (queue the rest and open the next when one finishes). Use the ticket key for <KEY> (a short slug of the goal when there is none) and n = 1, 2, 3...:
   a. Run \`~/.claude/hooks/snj/snj-mem-guard.sh check\`; if free RAM is below 12%, queue the task and open nothing. Then pick the codename: if \`~/.claude/hooks/snj/snj-term\` exists, run \`~/.claude/hooks/snj/snj-term codename hc --seed "<KEY>-dev<n>"\` and take codename from its JSON; without it, or if it fails, there is no codename.
   b. \`git -C <ticket worktree> worktree add -b <ticket-branch>-dev<n> <ticket worktree>-dev<n> <ticket-branch>\`, then write the task brief to \`<ticket worktree>-dev<n>/ai/factory/task.md\`: the files, the acceptance criteria, the tests to run, a time budget (about 20 minutes), the report format (files changed, real test output, open issues) and never commit.
   c. \`hc run --bg --keep --outlive-parent --json --cwd <ticket worktree>-dev<n> --label herdr.space=${space} --label herdr.tab=tb<16 random hex chars> --label factory.lead=${lead} --label factory.team=dev --label "factory.task=<task, under 40 chars>" [--label codename=<codename>] -- env FACTORY_DEV=1 claude\` and keep the terminal address from its JSON. FACTORY_DEV=1 makes the factory git guard deny every git commit and push in that session. Never select, focus or attach the new terminal or switch the space, tab or layout.
   d. \`hc wait <address> --timeout 30\` until Claude is ready, then \`hc send <address> "[relay factory-lead] Read ai/factory/task.md and do it."\`.
   Never put brief or follow-up text into a shell command: for a follow-up, append it to that task.md and send the fixed prompt \`hc send <address> "[relay factory-lead] Read the latest update at the end of ai/factory/task.md."\`. Every prompt you type into another session starts with [relay factory-lead]. Track each with \`hc wait <address> --timeout <s>\` and \`hc read <address>\`. These terminals do not wake you: poll them and end with FACTORY: CONTINUE, not WAIT, while only these developers are running. Stop and re-brief one still running well past its budget. QA stays factory:qa via the Agent tool, against the developers' worktrees, in small parallel batches. After QA passes, bring each developer's changes into the ticket worktree (developers never commit, so copy the working tree, not a branch: \`git -C <dev worktree> add -N . && git -C <dev worktree> diff HEAD --binary -- . ':!ai/factory/task.md' | git -C <ticket worktree> apply\`), touching only that task's files, then \`hc kill <address>\`. Leave the developer worktrees for me to clear.`

type BriefOpts = { briefPath?: string; herdrSession?: string; hcLead?: { terminal: string; space: string } }

const brief = (goal: string, o: BriefOpts = {}) => `You are the factory LEAD for: ${goal}

Run this like a real delivery team: the product team owns what and why, the tech lead owns how, they consult each other, researchers serve both, and you are the delivery lead who coordinates them. You orchestrate; you do not write feature code yourself. You are the steering agent and run on Opus: keep every decision, plan approval, verification and gate with you, and never hand steering to a smaller model.

${o.briefPath ? grillFromBrief(o.briefPath) : grill}
2. If the goal mimics or takes inspiration from an existing product, dispatch factory:reverse-engineer on it first (only targets I own or may study); its map of structure, behaviour and data flow feeds both the product team and the tech lead. Then decide whether the requirements are clear. Clear means the problem, users, acceptance criteria and expected UI are settled. If they are clear, skip the product team: the tech lead and dev team deliver. If they are not, or the idea needs analysis or prioritisation, dispatch the product team in parallel: factory:product-analyst (data and priority), factory:design-lead (guidance from the project's design system, for UI work) and factory:product-consultant (product frameworks, alternatives, riskiest assumption). When an idea is easier to judge by seeing it, have the product team shape a prototype with the dev team: one factory:developer builds a throwaway prototype in isolation: worktree from the design lead's guidance, then the product team reviews it. Either way, dispatch factory:tech-lead on the requirements for technical risks and edge cases. The product team and the tech lead consult each other through you: pass each product agent's questions for the tech lead to factory:tech-lead, and the tech lead's product decisions needed to the product agent that owns them, then fold both answers into the agreed scope and acceptance criteria. Keep it to two exchanges, and ask me with FACTORY: ASK only if the answers change scope.
3. Dispatch factory:researcher agents (in parallel where independent) and summarise their findings. Researchers serve both sides: dispatch them for the product team's questions (market, competitors, docs, tickets) as well as the dev team's, at any step. Pick each researcher's model by the question: model: haiku for quick lookups (find a file, read one doc, check a version), the default Sonnet for normal codebase or docs research, model: opus only for deep or ambiguous research (architecture trade-offs, conflicting sources, many systems).
4. Dispatch factory:planner to write ai/factory/plan.md. Show me a short summary and carry on; do not wait for approval.
${o.herdrSession ? herdrDevs(o.herdrSession) : o.hcLead ? hcAppDevs(o.hcLead.terminal, o.hcLead.space) : agentDevs}
6. Verify yourself: read the diffs and the real test output. Send gaps back to the developer. Tick a criterion in plan.md only with evidence.
7. When every criterion is ticked, summarise what will be committed and end with FACTORY: ASK, in the format below. Commit or push only after I say so. Before this gate, use FACTORY: ASK only when you are truly blocked.

${askFormat}

${whoAnswers}

End EVERY reply with exactly one line:
FACTORY: CONTINUE  (more work you can do without me)
FACTORY: WAIT      (background agents are running; their results will wake you)
FACTORY: ASK      (you need my answer or approval)
FACTORY: DONE      (all criteria met with evidence and I approved)`

const HERDR_AGENT = /^[a-z][a-z0-9_-]{0,31}$/

/** Inside herdr, reach the report target as a herdr agent; otherwise (or if that fails) as a Claude session. */
async function deliver($: Engine, lead: string, text: string): Promise<void> {
  const session = await $.env.get('HERDR_SESSION')
  if ((await $.env.get('HERDR_ENV')) === '1' && session && HERDR_AGENT.test(lead)) {
    const sent = await $.process.run(['herdr', 'agent', 'prompt', lead, text], { env: { HERDR_SESSION: session, HERDR_SOCKET_PATH: '' } })
    if (sent.exitCode === 0) return
  }
  await $.session.send({ to: lead, text })
}

/** Writes the run file the office view reads; it never breaks the run. */
async function publish($: Engine, o: { ended?: boolean; lead?: OfficeStatus; finished?: string } = {}): Promise<void> {
  try {
    const r = await read($, run)
    if (!r?.file || !r.lead) return
    const subagents = mergeAgents(r.agents ?? [], await $.agent.list()).filter(a => !a.terminal).map(a => (a.id === o.finished ? { ...a, status: 'done' as const } : a))
    const devs = (await $.env.get('HC_TERMINAL_ID')) ? await hcDevs($, r.lead.terminal) : []
    const agents = [...subagents, ...devs]
    const leadStatus = o.lead ?? r.leadStatus ?? 'working'
    await update($, run, x => (x ? { ...x, agents, leadStatus } : x))
    const file = { goal: r.goal, round: r.round, ended: !!o.ended, updatedAt: new Date(await $.clock.now()).toISOString(), lead: { ...r.lead, status: o.ended ? 'done' : leadStatus }, agents }
    await writeAtomic($, r.file, `${JSON.stringify(file, null, 2)}\n`)
  } catch {
    // ponytail: office view is best effort, a failed write only leaves it stale
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'factory', description: 'AI delivery team: lead runs product (when needed), tech lead, research, plan, dev and QA agents until the goal is met' })
    await $.command.register({ name: 'factory-stop', description: 'Stop the factory run' })
    await $.command.register({ name: 'factory-show', description: 'Show the factory hierarchy, flow and live agents' })
    await $.command.register({ name: 'factory-report', description: 'Send ASK, DONE and stop updates to a lead session', argumentHint: '[session name | off]' })
    return next(e)
  })

  on('command.run', { command: 'factory' }, async ($, e) => {
    const a = parseArgs(e.args)
    if (a.error) return { text: a.error }
    let goal = a.goal
    if (a.briefPath) {
      const path = a.briefPath.startsWith('/') ? a.briefPath : `${await $.session.cwd()}/${a.briefPath}`
      const text = await $.fs.read(path).catch(() => null)
      if (text === null) return { text: `factory: cannot read brief ${path}` }
      goal ||= briefTitle(text)
      a.briefPath = path
    }
    if (!goal) return { text: 'Usage: /factory [--brief <path>] [--no-herdr] <goal or Jira key>' }
    const session = (await $.env.get('HERDR_ENV')) === '1' ? await $.env.get('HERDR_SESSION') : undefined
    const herdrSession = a.noHerdr ? undefined : session || undefined
    const office = await leadOf($).catch(() => null)
    const hcLead = !a.noHerdr && !herdrSession && office?.space && (await $.env.get('HC_TERMINAL_ID')) ? { terminal: office.lead.terminal, space: office.space } : undefined
    await update($, run, () => ({ goal, round: 0, lastPrompt: '', agents: [], lead: office?.lead, leadStatus: 'working' as const, file: office?.path }))
    await publish($)
    $.ui.status(`factory: ${goal.slice(0, 40)}`)
    $.clock.after(0, () => void $.prompt.submit({ text: brief(goal, { briefPath: a.briefPath, herdrSession, hcLead }) }))
    const mode = herdrSession ? `developers in herdr tabs (${herdrSession})` : hcLead ? `developers in Herdr app terminals (${hcLead.space})` : 'developers as subagents'
    return { text: `${MAP}\n\nFactory started for: ${goal}\n${a.briefPath ? `Brief: ${a.briefPath}\n` : ''}Mode: ${mode}` }
  })

  on('command.run', { command: 'factory-show' }, async $ => {
    const r = await read($, run)
    const agents = (await $.agent.list()).filter(a => a.type.startsWith('factory:'))
    const live = agents.length
      ? agents.map(a => `  ${a.status.padEnd(9)} ${a.type.padEnd(25)} ${a.description}`).join('\n')
      : '  none yet'
    const state = r ? `Run: ${r.goal}\nRound ${r.round} of ${MAX_ROUNDS}` : 'No factory run active'
    return { text: `${MAP}\n\n${state}\nAgents\n${live}` }
  })

  on('command.run', { command: 'factory-report' }, async ($, e) => {
    const name = e.args.trim()
    if (!name) return { text: `Reporting to: ${(await read($, reportTo)) ?? 'nobody'}` }
    await update($, reportTo, () => (name === 'off' ? null : name))
    return { text: name === 'off' ? 'Factory reports off.' : `Factory reports go to ${name}.` }
  })

  on('command.run', { command: 'factory-stop' }, async $ => {
    await publish($, { ended: true })
    await update($, run, () => null)
    $.ui.status(undefined)
    return { text: 'Factory stopped.' }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer') {
      const r = await update($, run, x => (x ? { ...x, lastPrompt: RELAYED.test(e.text) ? '' : e.text } : x))
      if (r) {
        $.ui.status(`factory: running (round ${r.round})`)
        await publish($, { lead: 'working' })
      }
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const r = await read($, run)
    if (!r) return done
    if (e.agentId !== undefined) {
      await publish($, { finished: e.agentId })
      return done
    }
    if (e.reason !== 'answer') return done

    const signal = e.answer.match(/FACTORY:\s*(CONTINUE|WAIT|ASK|DONE)/)?.[1]
    const lead = await read($, reportTo)
    const capped = signal === 'CONTINUE' && r.round >= MAX_ROUNDS
    if (lead && (signal === 'ASK' || signal === 'DONE' || !signal || capped)) {
      const ask = signal === 'DONE' ? 'DONE' : HUMAN_ONLY.test(e.answer) ? 'ASK (HUMAN ONLY: pass to the human verbatim, do not answer)' : 'ASK (answer from the brief and your context; ask the human if unsure)'
      const tag = capped ? `STOPPED at ${MAX_ROUNDS} rounds` : ask
      const text = `[relay factory] factory "${r.goal}": ${tag} (round ${r.round})\n${e.answer.slice(-1500)}`
      $.clock.after(0, () => void deliver($, lead, text))
    }
    const ends = signal === 'DONE' || (signal === 'CONTINUE' && r.round >= MAX_ROUNDS)
    const leadStatus: OfficeStatus = signal === 'DONE' ? 'done' : signal === 'WAIT' ? 'idle' : signal === 'CONTINUE' ? 'working' : 'blocked'
    await publish($, { ended: ends, lead: leadStatus })
    if (signal === 'WAIT') {
      $.ui.status(`factory: waiting on agents (round ${r.round})`)
    } else if (signal === 'DONE') {
      await update($, run, () => null)
      $.ui.status(undefined)
      await $.ui.notify('Factory finished', { title: r.goal })
    } else if (signal !== 'CONTINUE') {
      $.ui.status(`factory: waiting for you (round ${r.round})`)
      await $.ui.notify('Factory needs your input', { title: r.goal })
    } else if (r.round >= MAX_ROUNDS) {
      await update($, run, () => null)
      $.ui.status(`factory: stopped at ${MAX_ROUNDS} rounds`)
    } else {
      await update($, run, x => (x ? { ...x, round: x.round + 1 } : x))
      await publish($)
      $.ui.status(`factory: round ${r.round + 1}`)
      $.clock.after(0, () => void $.prompt.submit({ text: 'Continue the factory run from where you stopped. If you are only waiting on background agents, end with FACTORY: WAIT. Otherwise end with a FACTORY: line.' }))
    }
    return done
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (e.subagentType.startsWith('factory:')) await publish($)
    return started
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (GIT_WRITE.test(e.command) && (await $.env.get('FACTORY_DEV')) === '1')
      return { deny: 'factory: developers never commit or push. Report your changes to the lead instead.' }
    const r = await read($, run)
    if (r && GIT_WRITE.test(e.command) && !approved(r.lastPrompt))
      return { deny: 'factory: commit and push need approval in my latest message. End with FACTORY: ASK.' }
    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'factory: its git guard failed.' }))
}
