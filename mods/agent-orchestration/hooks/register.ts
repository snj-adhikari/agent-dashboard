import type { EngineInterface as Engine, Register } from 'claude-code'

const POLL_MS = 3000
const STALE_MS = 12 * 60 * 60 * 1000
const REPLY_TOOL = 'subtab_reply'
const REPLY_TOOL_FULL = 'mcp__agent-orchestration__subtab_reply'
const FINISH_TEXT = 'Finished: write the summary and hand off now.'
const RUNNING_ON = /^[A-Z][A-Z-]*:\s*(CONTINUE|WAIT)\b/
const STAY_IN_MAIN = ['loop', 'update-config', 'keybindings-help', 'fewer-permission-prompts']
const MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto']

const RELAY_CONTEXT = `This prompt was relayed by the agent-orchestration mod from a skill running in a cmux sub-tab; the user did not type it.
- "asks": the sub-tab is waiting for input. Act as the user: answer it with the ${REPLY_TOOL} tool (surface = the id in the brackets) from the mission, goal and context the user gave you in this tab, when the answer clearly follows from them. If it is a judgement call, or approves publishing, posting, committing, pushing or merging, ask the user first and relay their answer.
- When the user is finished with it (no, that's all, wrap up, stop), call ${REPLY_TOOL} with finish: true.
- "done": the sub-tab finished and closed. Give the user a short gist of the summary.`

const childContext = (dir: string) =>
  `You are running in a cmux sub-tab opened for one skill. When that skill is fully finished (including any gates or questions answered here), write a compact summary to ${dir}/summary.md: max 20 lines, no tables, line 1 = skill + outcome, then key results, file paths, PR/ticket links, and anything still needing the user. Then create the empty file ${dir}/done. That closes this tab and hands the summary to the main tab, so do it only once, at the very end. Until then, ask any question as plain text at the end of your reply, never with AskUserQuestion: the main tab's agent reads your last message and answers here.`

type Env = { state: string; surface: string; runId: string }
type Meta = { main: string; skill: string; child: string; started: number; notified?: boolean }
type Ask = { surface: string; skill: string; text: string }

async function readEnv($: Engine): Promise<Env> {
  const home = (await $.env.get('HOME')) ?? ''
  const surface = (await $.env.get('CMUX_SURFACE_ID')) ?? ''
  const runId = (await $.env.get('AGENT_SUBTAB_ID')) ?? ''
  return { state: `${home}/.claude/agent-orchestration`, surface, runId }
}

const readMeta = async ($: Engine, dir: string): Promise<Meta | undefined> =>
  (await $.fs.exists(`${dir}/meta.json`)) ? (JSON.parse(await $.fs.read(`${dir}/meta.json`)) as Meta) : undefined

const modeFile = (env: Env) => `${env.state}/mode-${env.surface}.json`

async function readMode($: Engine, env: Env): Promise<string> {
  try {
    const { mode } = JSON.parse(await $.fs.read(modeFile(env))) as { mode?: unknown }
    return typeof mode === 'string' && MODES.includes(mode) ? mode : 'default'
  } catch {
    return 'default'
  }
}

async function isSkill($: Engine, name: string): Promise<boolean> {
  const extra = ((await $.env.get('AGENT_SUBTAB_STAY')) ?? '').split(',').map(s => s.trim())
  if ([...STAY_IN_MAIN, ...extra].includes(name.split(':').pop() ?? name)) return false
  const cmd = (await $.command.list()).find(c => c.name === name)
  return cmd !== undefined && cmd.source !== 'builtin'
}

async function openSubtab($: Engine, env: Env, skill: string, prompt: string): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
  const dir = `${env.state}/runs/${id}`
  await $.process.run(['mkdir', '-p', dir])
  await $.fs.write(`${dir}/prompt.txt`, prompt)
  const { stdout } = await $.process.run(['cmux', 'identify'])
  const pane = (JSON.parse(stdout) as { caller: { pane_ref: string } }).caller.pane_ref
  const cmd = `cd ${JSON.stringify(await $.session.cwd())} && AGENT_SUBTAB_ID=${id} claude --permission-mode ${await readMode($, env)} "$(cat ${JSON.stringify(`${dir}/prompt.txt`)})"`
  const opened = await $.process.run(['cmux', 'new-surface', '--type', 'terminal', '--pane', pane, '--focus', 'false', '--command', cmd])
  const child = /surface:\d+/.exec(opened.stdout)?.[0]
  if (!child) throw new Error(`cmux new-surface failed: ${opened.stderr.trim()}`)
  await $.process.run(['cmux', 'rename-tab', '--surface', child, `/${skill.split(':').pop()}`])
  const meta: Meta = { main: env.surface, skill: `/${skill}`, child, started: await $.clock.now() }
  await $.fs.write(`${dir}/meta.json`, JSON.stringify(meta))
  return child
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const env = await readEnv($)
    if (!env.surface || env.runId) return started

    await $.tool.register({
      name: REPLY_TOOL,
      description: 'Answer a cmux skill sub-tab ([subtab <id> ...] prompts), or end it with finish: true when the user is done so it writes its summary and closes itself. Never close sub-tabs with cmux directly: that skips the summary.',
      inputSchema: {
        type: 'object',
        properties: {
          surface: { type: 'string', description: 'The sub-tab surface id from the [subtab <id> ...] prompt.' },
          text: { type: 'string', description: 'The answer, as the sub-tab should receive it.' },
          finish: { type: 'boolean', description: 'True to tell the sub-tab to wrap up and hand off; text is ignored.' },
        },
        required: ['surface'],
      },
      isDeferred: false,
    })

    const finishRun = async (dir: string, meta: Meta, summary: string) => {
      await $.process.run(['rm', '-rf', dir])
      await $.process.run(['cmux', 'close-surface', '--surface', meta.child])
      await $.process.run(['cmux', 'notify', '--title', `${meta.skill} done`, '--body', summary.split('\n')[0] ?? ''])
      void $.prompt.submit({ text: `[subtab done]\n${summary}` })
    }

    const poll = async () => {
      const runs = `${env.state}/runs`
      if (!(await $.fs.exists(runs))) return
      const tree = (await $.process.run(['cmux', 'tree'])).stdout
      for (const run of await $.fs.list(runs)) {
        const dir = `${runs}/${run.name}`
        const meta = await readMeta($, dir)
        if (!meta || meta.main !== env.surface) continue

        for (const f of await $.fs.list(dir)) {
          if (!/^ask-\d+\.json$/.test(f.name)) continue
          const ask = JSON.parse(await $.fs.read(`${dir}/${f.name}`)) as Ask
          await $.process.run(['mv', `${dir}/${f.name}`, `${dir}/${f.name}.sent`])
          void $.prompt.submit({ text: `[subtab ${ask.surface} ${ask.skill} asks]\n${ask.text}` })
        }

        if (await $.fs.exists(`${dir}/done`)) {
          const summary = (await $.fs.exists(`${dir}/summary.md`)) ? (await $.fs.read(`${dir}/summary.md`)).trim() : ''
          await finishRun(dir, meta, summary || `${meta.skill} finished in ${meta.child} (no summary written)`)
        } else if (!tree.includes(meta.child)) {
          await finishRun(dir, meta, `${meta.skill} sub-tab ${meta.child} was closed without a summary`)
        } else if (!meta.notified && (await $.clock.now()) - meta.started > STALE_MS) {
          await $.process.run(['cmux', 'notify', '--title', `${meta.skill} sub-tab still open`, '--body', `No handoff after 12h; left ${meta.child} open`])
          await $.fs.write(`${dir}/meta.json`, JSON.stringify({ ...meta, notified: true }))
        }
      }
    }

    $.clock.every(POLL_MS, () => void poll().catch(err => $.ui.log(`poll failed: ${String(err)}`, { to: 'debug' })))
    return started
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const env = await readEnv($)
    const mode = e.permission_mode
    if (env.surface && !env.runId && mode && MODES.includes(mode)) await $.fs.write(modeFile(env), JSON.stringify({ mode }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'plugin' && e.origin.name === $.plugin.name) {
      return next({ ...e, context: [...(e.context ?? []), RELAY_CONTEXT] })
    }
    const env = await readEnv($)
    if (env.runId) {
      return next({ ...e, context: [...(e.context ?? []), childContext(`${env.state}/runs/${env.runId}`)] })
    }
    if (!env.surface || !e.command || (await $.env.get('AGENT_SUBTAB_OFF')) === '1' || !(await isSkill($, e.command.name))) {
      return next(e)
    }
    const child = await openSubtab($, env, e.command.name, e.text)
    void $.clock.sleep(200).then(() => $.prompt.fill({ text: '' }))
    return { drop: `/${e.command.name} is running in sub-tab ${child} (same pane). It closes itself when done and the summary lands here.` }
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: REPLY_TOOL_FULL }, async ($, e) => {
    const { surface, text = '', finish } = e
    const flat = (finish ? FINISH_TEXT : text).replace(/\s*\n\s*/g, ' ').trim()
    const sent = await $.process.run(['cmux', 'send', '--surface', surface, flat])
    if (sent.exitCode !== 0) return { deny: `cmux send failed: ${sent.stderr.trim()}` }
    await $.clock.sleep(500)
    await $.process.run(['cmux', 'send-key', '--surface', surface, 'Enter'])
    return { result: `Sent to ${surface}.` }
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool !== 'Bash' || !/\bcmux\s+close-(surface|workspace)\b/.test(e.command)) return next(e)
    const env = await readEnv($)
    if (!env.surface || env.runId) return next(e)
    const runs = `${env.state}/runs`
    const active = (await $.fs.exists(runs)) ? await $.fs.list(runs) : []
    const { stdout: tree } = await $.process.run(['cmux', 'tree'])
    for (const run of active) {
      const meta = await readMeta($, `${runs}/${run.name}`)
      if (meta?.main === env.surface && tree.includes(meta.child)) {
        return { deny: `A skill sub-tab is still running. End it with ${REPLY_TOOL} finish: true so it writes its summary and closes itself.` }
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined || e.isAborted || !e.answer.trim()) return done
    if (RUNNING_ON.test(e.answer.trim().split('\n').at(-1)?.trim() ?? '')) return done
    const env = await readEnv($)
    if (!env.runId || !env.surface) return done
    const dir = `${env.state}/runs/${env.runId}`
    const meta = await readMeta($, dir)
    if (!meta || (await $.fs.exists(`${dir}/done`))) return done
    const ask: Ask = { surface: env.surface, skill: meta.skill, text: e.answer.trim().slice(-2500) }
    await $.fs.write(`${dir}/ask-${await $.clock.now()}.json`, JSON.stringify(ask))
    return done
  })
}
