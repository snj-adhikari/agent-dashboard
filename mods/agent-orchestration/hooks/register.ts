import type { EngineInterface as Engine, Register } from 'claude-code'

const POLL_MS = 3000
const STALE_MS = 12 * 60 * 60 * 1000
const REPLY_TOOL = 'subtab_reply'
const REPLY_TOOL_FULL = 'mcp__agent-orchestration__subtab_reply'
const FINISH_TEXT = 'Finished: write the summary and hand off now.'
const RUNNING_ON = /^[A-Z][A-Z-]*:\s*(CONTINUE|WAIT)\b/
const STAY_IN_MAIN = ['loop', 'update-config', 'keybindings-help', 'fewer-permission-prompts']
const MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto']

const CLOSE_CMD = /\bcmux\s+close-(surface|workspace)\b|\bherdr\s+(tab|pane)\s+close\b|\bhc\s+(kill|rm)\b/
const HC_ID = /^t[0-9a-z]{1,16}$/

const RELAY_CONTEXT = `This prompt was relayed by the agent-orchestration mod from a skill running in a sub-tab; the user did not type it.
- "asks": the sub-tab is waiting for input. Act as the user: answer it with the ${REPLY_TOOL} tool (surface = the id in the brackets) from the mission, goal and context the user gave you in this tab, when the answer clearly follows from them. If it is a judgement call, or approves publishing, posting or merging, ask the user first and relay their answer. When the sub-tab offers choices (a verdict, options, which items to keep), ask with AskUserQuestion, never as prose: the sub-tab's recommended option first with "(Recommended)" in its label, one question per choice it asks for (multiSelect for picking items to remove), and your own view in the option descriptions.
- A commit, push or PR request: ask the user with one AskUserQuestion, recommended option first = what the sub-tab asked for (e.g. "Approve commit + push + create PR", "Commit + push", "Commit only", "Deny"), then relay their pick with ${REPLY_TOOL}. Never approve on your own.
- When the user is finished with it (no, that's all, wrap up, stop), call ${REPLY_TOOL} with finish: true.
- "done": the sub-tab finished and closed. Give the user a short gist of the summary.`

const approverContext = (cmd: string) =>
  `- Approval helper: after the user approves a commit, push or PR for a herdr sub-tab, run \`${cmd} <session> <pane> <kinds> [branch]\` (pane = the surface id in the brackets, session = this tab's $HERDR_SESSION, or hc in the Herdr app, kinds joined with +, e.g. commit+push+pr) before replying with ${REPLY_TOOL}, so the sub-tab's gate lets it retry once. Not for cmux sub-tabs.`

const childContext = (dir: string) =>
  `You are running in a sub-tab opened for one skill. When that skill is fully finished (including any gates or questions answered here), write a compact summary to ${dir}/summary.md: max 20 lines, no tables, line 1 = skill + outcome, then key results, file paths, PR/ticket links, and anything still needing the user. Then create the empty file ${dir}/done. That closes this tab and hands the summary to the main tab, so do it only once, at the very end. Until then, ask any question as plain text at the end of your reply, never with AskUserQuestion: the main tab's agent reads your last message and answers here with a prompt starting [subtab <id> reply].`

type Env = { state: string; surface: string; self: string; runId: string; herdr: boolean; app: boolean; workspace: string; session: string }
type Meta = { main: string; skill: string; child: string; tab?: string; session?: string; started: number; notified?: boolean }
type OpenArgs = { cwd: string; id: string; dir: string; mode: string; prompt: string; label: string }
type Opened = { child: string; tab?: string; start?: () => Promise<unknown> }
type Driver = {
  open: (a: OpenArgs) => Promise<Opened>
  send: (target: string, text: string) => Promise<string>
  close: (meta: Meta) => Promise<unknown>
  live: () => Promise<(meta: Meta) => boolean>
}
type Ask = { surface: string; skill: string; text: string }

async function readEnv($: Engine): Promise<Env> {
  const home = (await $.env.get('HOME')) ?? ''
  const herdr = (await $.env.get('HERDR_ENV')) === '1'
  const runId = (await $.env.get('AGENT_SUBTAB_ID')) ?? ''
  const state = `${home}/.claude/agent-orchestration`
  const terminal = (await $.env.get('HC_TERMINAL_ID')) ?? ''
  if (!herdr && HC_ID.test(terminal)) {
    return { state, surface: `hc:${terminal}`, self: terminal, runId, herdr: false, app: true, workspace: '', session: 'hc' }
  }
  const session = (await $.env.get('HERDR_SESSION')) ?? ''
  const self = (herdr ? await $.env.get('HERDR_PANE_ID') : await $.env.get('CMUX_SURFACE_ID')) ?? ''
  const surface = herdr && self ? `${session}:${self}` : self
  const workspace = (await $.env.get('HERDR_WORKSPACE_ID')) ?? ''
  return { state, surface, self, runId, herdr, app: false, workspace, session }
}

const cmuxDriver = ($: Engine): Driver => ({
  async open({ cwd, id, dir, mode, label }) {
    const { stdout } = await $.process.run(['cmux', 'identify'])
    const pane = (JSON.parse(stdout) as { caller: { pane_ref: string } }).caller.pane_ref
    const cmd = `cd ${JSON.stringify(cwd)} && AGENT_SUBTAB_ID=${id} claude --permission-mode ${mode} "$(cat ${JSON.stringify(`${dir}/prompt.txt`)})"`
    const opened = await $.process.run(['cmux', 'new-surface', '--type', 'terminal', '--pane', pane, '--focus', 'false', '--command', cmd])
    const child = /surface:\d+/.exec(opened.stdout)?.[0]
    if (!child) throw new Error(`cmux new-surface failed: ${opened.stderr.trim()}`)
    await $.process.run(['cmux', 'rename-tab', '--surface', child, label])
    return { child }
  },
  async send(target, text) {
    const sent = await $.process.run(['cmux', 'send', '--surface', target, text])
    if (sent.exitCode !== 0) return `cmux send failed: ${sent.stderr.trim()}`
    await $.clock.sleep(500)
    await $.process.run(['cmux', 'send-key', '--surface', target, 'Enter'])
    return ''
  },
  close: meta => $.process.run(['cmux', 'close-surface', '--surface', meta.child]),
  async live() {
    const { stdout } = await $.process.run(['cmux', 'tree'])
    return meta => stdout.includes(meta.child)
  },
})

async function codename($: Engine, session: string, id: string): Promise<string | undefined> {
  const namer = ((await $.env.get('AGENT_SUBTAB_NAMER')) ?? '').trim().split(/\s+/).filter(Boolean)
  if (namer.length === 0) return undefined
  try {
    const r = await $.process.run([...namer, session, '--seed', id])
    const name = (JSON.parse(r.stdout) as { codename?: unknown }).codename
    return r.exitCode === 0 && typeof name === 'string' && /^[a-z][a-z0-9_-]{0,27}$/.test(name) ? name : undefined
  } catch {
    return undefined
  }
}

const herdrDriver = ($: Engine, env: Env): Driver => {
  const herdr = (argv: string[], session = env.session) => $.process.run(['herdr', ...argv], { env: { HERDR_SESSION: session } })
  return {
    async open({ cwd, id, dir, mode, prompt, label: skillLabel }) {
      const code = await codename($, env.session, id)
      const label = code ? `${skillLabel} · ${code}` : skillLabel
      const argv = ['tab', 'create', '--cwd', cwd, '--label', label, '--env', `AGENT_SUBTAB_ID=${id}`, '--no-focus']
      if (env.workspace) argv.push('--workspace', env.workspace)
      const made = await herdr(argv)
      let result: { tab?: { tab_id?: string }; root_pane?: { pane_id?: string } } | undefined
      try {
        result = (JSON.parse(made.stdout) as { result?: typeof result }).result
      } catch {
        result = undefined
      }
      const tab = result?.tab?.tab_id
      const child = result?.root_pane?.pane_id
      if (!tab || !child) throw new Error(`herdr tab create failed: ${made.stderr.trim()}`)
      const agent = `sub-${code ?? id}`
      const show = ((await $.env.get('AGENT_SUBTAB_SHOW')) ?? '').trim().split(/\s+/).filter(Boolean)
      const start = async () => {
        const started = await herdr(['agent', 'start', agent, '--kind', 'claude', '--pane', child, '--', '--permission-mode', mode])
        const prompted = started.exitCode === 0 ? await herdr(['agent', 'prompt', child, prompt]) : started
        if (prompted.exitCode !== 0) {
          await herdr(['tab', 'close', tab])
          await $.process.run(['rm', '-rf', dir])
          await notify($, `${skillLabel} not started`, `herdr agent failed: ${prompted.stderr.trim()}`)
          return
        }
        if (code) await herdr(['pane', 'report-metadata', child, '--source', 'agent-orchestration', '--display-agent', code, '--token', `codename=${code}`])
        if (show.length === 0) return
        const shown = await $.process.run([...show, env.session, agent, '--title', label])
        if (shown.exitCode !== 0) $.ui.log(`${show[0]} failed: ${shown.stderr.trim()}`, { to: 'debug' })
      }
      return { child, tab, start }
    },
    async send(target, text) {
      const sent = await herdr(['agent', 'prompt', target, text])
      return sent.exitCode === 0 ? '' : `herdr agent prompt failed: ${sent.stderr.trim()}`
    },
    close: meta => herdr(meta.tab ? ['tab', 'close', meta.tab] : ['pane', 'close', meta.child], meta.session ?? env.session),
    async live() {
      const listed = await herdr(['pane', 'list'])
      if (listed.exitCode !== 0) return () => true
      return meta => listed.stdout.includes(`"${meta.child}"`)
    },
  }
}

const parse = <T>(text: string): T | undefined => {
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

const herdrAppDriver = ($: Engine, env: Env): Driver => {
  const hc = (argv: string[]) => $.process.run(['hc', ...argv])
  return {
    async open({ cwd, id, mode, prompt, label: skillLabel }) {
      const code = await codename($, env.session, id)
      const label = code ? `${skillLabel} · ${code}` : skillLabel
      const me = parse<{ labels?: Record<string, string> }>((await hc(['get', env.self, '--json'])).stdout)
      const space = me?.labels?.['herdr.space']
      const tab = `sub-${id}`
      const argv = ['run', '--bg', '--json', '--no-parent', '--name', `sub-${code ?? id}`, '--cwd', cwd, '--label', `agent=sub-${code ?? id}`]
      if (space) argv.push('--label', `herdr.space=${space}`, '--label', `herdr.tab=${tab}`)
      const made = await hc([...argv, '--', 'env', `AGENT_SUBTAB_ID=${id}`, 'claude', '--permission-mode', mode, prompt])
      const child = parse<{ address?: string }>(made.stdout)?.address
      if (made.exitCode !== 0 || !child) throw new Error(`hc run failed: ${made.stderr.trim()}`)
      const start = async () => {
        if (!space) return
        await $.clock.sleep(1500)
        await $.process.run(['herdr-app', 'do', 'tab.rename', JSON.stringify({ id: tab, name: label })])
      }
      return { child, start }
    },
    async send(target, text) {
      const sent = await hc(['send', target, text])
      return sent.exitCode === 0 ? '' : `hc send failed: ${sent.stderr.trim()}`
    },
    close: async meta => {
      await hc(['kill', meta.child])
      return hc(['rm', meta.child])
    },
    async live() {
      const listed = await hc(['ls', '--json'])
      const terminals = parse<{ terminals?: { address?: string }[] }>(listed.stdout)?.terminals
      if (listed.exitCode !== 0 || !terminals) return () => true
      const live = new Set(terminals.map(t => t.address))
      return meta => live.has(meta.child)
    },
  }
}

const driverFor = ($: Engine, env: Env): Driver => (env.herdr ? herdrDriver($, env) : env.app ? herdrAppDriver($, env) : cmuxDriver($))

const notify = async ($: Engine, title: string, body: string) => {
  try {
    return await $.process.run(['cmux', 'notify', '--title', title, '--body', body])
  } catch {
    return undefined
  }
}

async function guardRefusal($: Engine): Promise<string | undefined> {
  const argv = ((await $.env.get('AGENT_SUBTAB_GUARD')) ?? '').trim().split(/\s+/).filter(Boolean)
  if (argv.length === 0) return undefined
  try {
    const r = await $.process.run(argv)
    return r.exitCode === 0 ? undefined : r.stdout.trim() || `${argv[0]} exited ${r.exitCode}`
  } catch (err) {
    return `${argv[0]} failed: ${String(err)}`
  }
}

const readMeta = async ($: Engine, dir: string): Promise<Meta | undefined> =>
  (await $.fs.exists(`${dir}/meta.json`)) ? (JSON.parse(await $.fs.read(`${dir}/meta.json`)) as Meta) : undefined

const modeFile = (env: Env) => `${env.state}/mode-${env.surface}.json`

async function readMode($: Engine, env: Env): Promise<string> {
  const preset = ((await $.env.get('AGENT_SUBTAB_MODE')) ?? '').trim()
  const fallback = MODES.includes(preset) ? preset : 'default'
  try {
    const { mode } = JSON.parse(await $.fs.read(modeFile(env))) as { mode?: unknown }
    return typeof mode === 'string' && MODES.includes(mode) ? mode : fallback
  } catch {
    return fallback
  }
}

async function isSkill($: Engine, name: string): Promise<boolean> {
  const extra = ((await $.env.get('AGENT_SUBTAB_STAY')) ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const base = name.split(':').pop() ?? name
  const stays = (s: string) => (s.endsWith('*') ? base.startsWith(s.slice(0, -1)) : s === base)
  if ([...STAY_IN_MAIN, ...extra].some(stays)) return false
  const cmd = (await $.command.list()).find(c => c.name === name)
  return cmd !== undefined && cmd.source !== 'builtin'
}

async function openSubtab($: Engine, env: Env, skill: string, prompt: string): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
  const dir = `${env.state}/runs/${id}`
  await $.process.run(['mkdir', '-p', dir])
  await $.fs.write(`${dir}/prompt.txt`, prompt)
  const label = `/${skill.split(':').pop()}`
  const opened = await driverFor($, env).open({ cwd: await $.session.cwd(), id, dir, mode: await readMode($, env), prompt, label })
  const { child, tab, start } = opened
  const meta: Meta = { main: env.surface, skill: `/${skill}`, child, ...(tab ? { tab } : {}), ...(env.herdr || env.app ? { session: env.session } : {}), started: await $.clock.now() }
  await $.fs.write(`${dir}/meta.json`, JSON.stringify(meta))
  if (start) void start().catch(err => $.ui.log(`sub-tab start failed: ${String(err)}`, { to: 'debug' }))
  return child
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const env = await readEnv($)
    if (!env.surface || env.runId) return started

    await $.tool.register({
      name: REPLY_TOOL,
      description: 'Answer a skill sub-tab ([subtab <id> ...] prompts), or end it with finish: true when the user is done so it writes its summary and closes itself. Never close sub-tabs with cmux or herdr directly: that skips the summary.',
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

    const driver = driverFor($, env)
    const finishRun = async (dir: string, meta: Meta, summary: string) => {
      await $.process.run(['rm', '-rf', dir])
      await driver.close(meta)
      await notify($, `${meta.skill} done`, summary.split('\n')[0] ?? '')
      void $.prompt.submit({ text: `[subtab done]\n${summary}` })
    }

    const poll = async () => {
      const runs = `${env.state}/runs`
      if (!(await $.fs.exists(runs))) return
      const isLive = await driver.live()
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
        } else if (!isLive(meta)) {
          await finishRun(dir, meta, `${meta.skill} sub-tab ${meta.child} was closed without a summary`)
        } else if (!meta.notified && (await $.clock.now()) - meta.started > STALE_MS) {
          await notify($, `${meta.skill} sub-tab still open`, `No handoff after 12h; left ${meta.child} open`)
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
      const approver = ((await $.env.get('AGENT_SUBTAB_APPROVER')) ?? '').trim()
      return next({ ...e, context: [...(e.context ?? []), RELAY_CONTEXT, ...(approver ? [approverContext(approver)] : [])] })
    }
    const env = await readEnv($)
    if (env.runId) {
      return next({ ...e, context: [...(e.context ?? []), childContext(`${env.state}/runs/${env.runId}`)] })
    }
    if (!env.surface || !e.command || (await $.env.get('AGENT_SUBTAB_OFF')) === '1' || !(await isSkill($, e.command.name))) {
      return next(e)
    }
    const refused = await guardRefusal($)
    if (refused) return { drop: `/${e.command.name} not opened in a sub-tab: ${refused}` }
    const child = await openSubtab($, env, e.command.name, e.text)
    void $.clock.sleep(200).then(() => $.prompt.fill({ text: '' }))
    return { drop: `/${e.command.name} is running in sub-tab ${child}. It closes itself when done and the summary lands here.` }
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: REPLY_TOOL_FULL }, async ($, e) => {
    const { surface, text = '', finish } = e
    const flat = (finish ? FINISH_TEXT : text).replace(/\s*\n\s*/g, ' ').trim()
    const failed = await driverFor($, await readEnv($)).send(surface, `[subtab ${surface} reply] ${flat}`)
    return failed ? { deny: failed } : { result: `Sent to ${surface}.` }
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool !== 'Bash' || !CLOSE_CMD.test(e.command)) return next(e)
    const env = await readEnv($)
    if (!env.surface || env.runId) return next(e)
    const runs = `${env.state}/runs`
    const active = (await $.fs.exists(runs)) ? await $.fs.list(runs) : []
    const isLive = await driverFor($, env).live()
    for (const run of active) {
      const meta = await readMeta($, `${runs}/${run.name}`)
      if (meta?.main === env.surface && isLive(meta)) {
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
    const ask: Ask = { surface: env.self, skill: meta.skill, text: e.answer.trim().slice(-2500) }
    await $.fs.write(`${dir}/ask-${await $.clock.now()}.json`, JSON.stringify(ask))
    return done
  })
}
