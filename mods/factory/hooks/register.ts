import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { FactoryRun } from '../types'

const run = atom({ plugin: 'factory', key: 'run' } as const, null as FactoryRun)
const reportTo = atom({ plugin: 'factory', key: 'reportTo' } as const, null as string | null)
// ponytail: fixed round cap, make it a userConfig option if runs need longer
const MAX_ROUNDS = 30
const GIT_WRITE = /\bgit\s+(commit|push)\b/
const APPROVED = /\b(commit|push)\b/i

const MAP = `FACTORY
You
 └─ Lead (Opus): grills you, plans, verifies, never codes
     ├─ researcher        Haiku/Sonnet/Opus by task, read-only
     ├─ reverse-engineer  Sonnet  REA: how a product works
     ├─ planner           Opus    ai/factory/plan.md
     ├─ developer x N     Sonnet  one task each, tests
     └─ qa                Sonnet  build, lint, screenshots

Flow
  grill me ──ASK──▶ you answer, one question at a time
     │ until nothing is ambiguous, then runs on its own
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

const brief = (goal: string) => `You are the factory LEAD for: ${goal}

You orchestrate; you do not write feature code yourself. You are the steering agent and run on Opus: keep every decision, plan approval, verification and gate with you, and never hand steering to a smaller model.

1. Grill me first, ONE question per reply, then end with FACTORY: ASK and wait for my answer. Base each next question on my answers so far; cover scope, acceptance criteria, repo, branch, environments, what "done" means and what is out of scope. Keep going until nothing is ambiguous. Then restate the agreed scope and acceptance criteria as a short list and end with FACTORY: CONTINUE: from here you run on your own without asking me again until the commit gate.
2. Dispatch factory:researcher agents (in parallel where independent) and summarise their findings. Pick each researcher's model by the question: model: haiku for quick lookups (find a file, read one doc, check a version), the default Sonnet for normal codebase or docs research, model: opus only for deep or ambiguous research (architecture trade-offs, conflicting sources, many systems). If the goal is to rebuild or match an existing product beyond its UI (behaviour, data flow, APIs), also dispatch factory:reverse-engineer on it first.
3. Dispatch factory:planner to write ai/factory/plan.md. Show me a short summary and carry on; do not wait for approval.
4. Dispatch one factory:developer per independent task, each with isolation: worktree, then factory:qa against the acceptance criteria. Give every agent a time budget (about 20 minutes) and tell it to report what it has when the budget runs out; split QA into small parallel batches. An agent still running well past its budget is stuck: stop it and re-dispatch a smaller task. Pick the model per task: keep each agent's default (Opus for planning, Sonnet for dev and QA), but pass model: haiku for small, basic tasks such as a one-file mechanical change, a rename, a quick lookup or re-running a check.
5. Verify yourself: read the diffs and the real test output. Send gaps back to the developer. Tick a criterion in plan.md only with evidence.
6. When every criterion is ticked, summarise what will be committed and end with FACTORY: ASK. Commit or push only after I say so. Before this gate, use FACTORY: ASK only when you are truly blocked.

End EVERY reply with exactly one line:
FACTORY: CONTINUE  (more work you can do without me)
FACTORY: WAIT      (background agents are running; their results will wake you)
FACTORY: ASK      (you need my answer or approval)
FACTORY: DONE      (all criteria met with evidence and I approved)`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'factory', description: 'Lead agent runs research, plan, dev and QA agents until the goal is met' })
    await $.command.register({ name: 'factory-stop', description: 'Stop the factory run' })
    await $.command.register({ name: 'factory-show', description: 'Show the factory hierarchy, flow and live agents' })
    await $.command.register({ name: 'factory-report', description: 'Send ASK, DONE and stop updates to a lead session', argumentHint: '[session name | off]' })
    return next(e)
  })

  on('command.run', { command: 'factory' }, async ($, e) => {
    const goal = e.args.trim()
    if (!goal) return { text: 'Usage: /factory <goal or Jira key>' }
    await update($, run, () => ({ goal, round: 0, lastPrompt: '' }))
    $.ui.status(`factory: ${goal.slice(0, 40)}`)
    $.clock.after(0, () => void $.prompt.submit({ text: brief(goal) }))
    return { text: `${MAP}\n\nFactory started for: ${goal}` }
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
    await update($, run, () => null)
    $.ui.status(undefined)
    return { text: 'Factory stopped.' }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer') {
      const r = await update($, run, x => (x ? { ...x, lastPrompt: e.text } : x))
      if (r) $.ui.status(`factory: running (round ${r.round})`)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const r = await read($, run)
    if (!r || e.agentId !== undefined || e.reason !== 'answer') return done

    const signal = e.answer.match(/FACTORY:\s*(CONTINUE|WAIT|ASK|DONE)/)?.[1]
    const lead = await read($, reportTo)
    const capped = signal === 'CONTINUE' && r.round >= MAX_ROUNDS
    if (lead && (signal === 'ASK' || signal === 'DONE' || !signal || capped)) {
      const tag = capped ? `STOPPED at ${MAX_ROUNDS} rounds` : signal ?? 'ASK'
      const text = `factory "${r.goal}": ${tag} (round ${r.round})\n${e.answer.slice(-1500)}`
      $.clock.after(0, () => void $.session.send({ to: lead, text }))
    }
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
      $.ui.status(`factory: round ${r.round + 1}`)
      $.clock.after(0, () => void $.prompt.submit({ text: 'Continue the factory run from where you stopped. If you are only waiting on background agents, end with FACTORY: WAIT. Otherwise end with a FACTORY: line.' }))
    }
    return done
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const r = await read($, run)
    if (r && GIT_WRITE.test(e.command) && !APPROVED.test(r.lastPrompt))
      return { deny: 'factory: commit and push need approval in my latest message. End with FACTORY: ASK.' }
    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'factory: its git guard failed.' }))
}
