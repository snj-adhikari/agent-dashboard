import type { EngineInterface as Engine, Register } from 'claude-code'

const POLL_MS = 3000
const STALE_MS = 12 * 60 * 60 * 1000
const REPLY_TOOL = 'subtab_reply'
const REPLY_TOOL_FULL = 'mcp__agent-orchestration__subtab_reply'
const SEND_TOOL = 'agent_send'
const MAIN_TOOL = 'agent_main'
const WATCH_MS = 10000
const RELEASE = /\b(release|drop|give up|stop being)\b[^.?!\n]{0,20}\bmain\b|\bnot (the )?main\b/i
const CLAIM = /\b(claim|you are|you're|be|become)\b[^.?!\n]{0,20}\bmain\b/i
const MENTIONS_AGENTS = /\bagents?\b/i
const KEEP_EYE = /\b(keep (an? )?(eye|aye|watch) on|keep watching|watch over|monitor|track)\b/i
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
type Peer = { id: string; name: string; status: string; aka?: string }
type Claim = { surface: string; at: number; focus?: string[] }

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


async function scopeOf($: Engine, env: Env): Promise<string | undefined> {
  if (env.app) {
    const space = parse<{ labels?: Record<string, string> }>((await $.process.run(['hc', 'get', env.self, '--json'])).stdout)?.labels?.['herdr.space']
    return space ? `hc:${space}` : undefined
  }
  if (env.herdr) return env.workspace ? `herdr:${env.session}:${env.workspace}` : undefined
  const ws = (await $.env.get('CMUX_WORKSPACE_ID')) ?? ''
  return ws ? `cmux:${ws}` : undefined
}

/** Every other terminal in the main tab's Herdr space, herdr workspace or cmux workspace; undefined when the host can't be read. */
async function listPeers($: Engine, env: Env, scope: string): Promise<Peer[] | undefined> {
  const [host, ...rest] = scope.split(':')
  if (host === 'hc') {
    const r = await $.process.run(['hc', 'ls', '--label', `herdr.space=${rest.join(':')}`, '--json'])
    const terminals = parse<{ terminals?: { address?: string; name?: string; where?: string; status?: string; state?: string }[] }>(r.stdout)?.terminals
    if (r.exitCode !== 0 || !terminals) return undefined
    return terminals
      .filter(t => t.address && t.address !== env.self)
      .map(t => ({ id: t.address as string, name: t.name || t.where?.split(' / ').pop() || (t.address as string), status: t.status || t.state || 'unknown' }))
  }
  if (host === 'herdr') {
    const r = await $.process.run(['herdr', 'agent', 'list'], { env: { HERDR_SESSION: env.session } })
    const agents = parse<{ result?: { agents?: Record<string, unknown>[] } }>(r.stdout)?.result?.agents
    if (r.exitCode !== 0 || !agents) return undefined
    return agents
      .filter(a => a.workspace_id === env.workspace && typeof a.pane_id === 'string' && a.pane_id !== env.self)
      .map(a => ({ id: a.pane_id as string, name: String(a.display_agent || a.name || a.pane_id), status: String(a.agent_status || 'unknown') }))
  }
  const ws = rest.join(':')
  const panes = parse<{ panes?: { ref: string }[] }>((await $.process.run(['cmux', '--json', 'list-panes', '--workspace', ws])).stdout)?.panes
  if (!panes) return undefined
  const peers: Peer[] = []
  for (const pane of panes) {
    const listed = parse<{ surfaces?: { ref: string; id?: string; type?: string; title?: string }[] }>(
      (await $.process.run(['cmux', '--json', 'list-pane-surfaces', '--workspace', ws, '--pane', pane.ref])).stdout,
    )
    for (const s of listed?.surfaces ?? []) {
      if (s.type === 'terminal' && s.ref !== env.self && s.id !== env.self) peers.push({ id: s.ref, name: s.title || s.ref, status: 'unknown', ...(s.id ? { aka: s.id } : {}) })
    }
  }
  return peers
}

const approverCmd = async ($: Engine) => ((await $.env.get('AGENT_SUBTAB_APPROVER')) ?? '').trim()

const is = (p: Peer, id: string) => p.id === id || p.aka === id

const claimFile = (env: Env, scope: string) => `${env.state}/main/${scope.replace(/[^\w.-]/g, '_')}.json`

async function readClaim($: Engine, env: Env, scope: string): Promise<Claim | undefined> {
  try {
    return JSON.parse(await $.fs.read(claimFile(env, scope))) as Claim
  } catch {
    return undefined
  }
}

async function writeClaim($: Engine, env: Env, scope: string, focus: string[] = []): Promise<void> {
  const held = await readClaim($, env, scope)
  const kept = held?.surface === env.self ? (held.focus ?? []) : []
  await $.process.run(['mkdir', '-p', `${env.state}/main`])
  await $.fs.write(claimFile(env, scope), JSON.stringify({ surface: env.self, at: await $.clock.now(), focus: [...new Set([...kept, ...focus])] }))
}

/** Peers named in the text by id or name; "all"/"everyone"/"agents" means every peer. */
export function named(text: string, peers: Peer[]): string[] {
  if (/(all|every(one|body)?|agents)\b/i.test(text)) return peers.map(p => p.id)
  const has = (word: string) => new RegExp(`(^|[^\\w-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w-])`, 'i').test(text)
  return peers.filter(p => has(p.id) || has(p.name)).map(p => p.id)
}

const peerTable = (peers: Peer[]) => (peers.length ? peers.map(p => `- ${p.name} (${p.id}): ${p.status}`).join('\n') : '- none')

const mainContext = (scope: string, peers: Peer[], approver = '') => `You are the main agent for ${scope}: the user claimed this tab and refers only to it. Other terminals there now:
${peerTable(peers)}
- Report terse per-agent status. Steer an agent with ${SEND_TOOL} (target = id or name, text is typed into its tab; close: true ends it). Read more with the host CLI or skills such as snj-pane-controller.
- Validate an agent's work when it reports done: read its diff, run the repo's checks, confirm it meets what the user asked. Send fixes back with ${SEND_TOOL} until it passes.
- Once validated, send the commit, push or PR instruction only if the user already asked for that in this session (say which message); otherwise ask the user first. Never for main, master, develop or staging, never a force push. Ask the user before merges, external posts, and closing an agent with unfinished work.${approver ? `\n- Commit/push gates don't count ${SEND_TOOL} text as the user's words: before sending an approved commit, push or PR step, run \`${approver} <session> <terminal> <kinds> [branch]\` (session = $HERDR_SESSION, or hc in the Herdr app; kinds joined with +).` : ''}`

const WATCH_CONTEXT = `This prompt was relayed by the agent-orchestration main-agent monitor; the user did not type it. Tell the user in one line per agent. For a finished agent, validate its work before reporting it done, then send the commit/push/PR step only if the user already asked for it in this session. Answer what follows from the user's goal here with ${SEND_TOOL}, and ask the user for judgement calls, approvals and anything that publishes.`

/** One relay line per change worth the main agent's attention; the first snapshot only sets the baseline. */
export function changes(prev: Map<string, Peer> | undefined, now: Peer[], skip: Set<string>, focus: Set<string> = new Set()): string[] {
  if (!prev) return []
  const lines: string[] = []
  for (const p of now) {
    if (skip.has(p.id)) continue
    const before = prev.get(p.id)?.status
    if (p.status === before) continue
    if (p.status === 'blocked') lines.push(`- ${p.name} (${p.id}) is blocked, waiting for input`)
    else if (before === 'working' && (p.status === 'done' || p.status === 'idle')) lines.push(`- ${p.name} (${p.id}) finished its turn`)
    else if (focus.has(p.id)) lines.push(`- ${p.name} (${p.id}) is now ${p.status}${before ? ` (was ${before})` : ''}`)
  }
  const ids = new Set(now.map(p => p.id))
  for (const p of prev.values()) if (!ids.has(p.id) && !skip.has(p.id)) lines.push(`- ${p.name} (${p.id}) closed`)
  return lines
}


/** Context for a typed prompt in a main-tab candidate: claim or release the workspace, or a live agent report when it mentions agents. */
async function mainPrompt($: Engine, env: Env, text: string): Promise<string | undefined> {
  const wantsRelease = RELEASE.test(text)
  const keepEye = !wantsRelease && KEEP_EYE.test(text)
  const wantsClaim = !wantsRelease && (keepEye || CLAIM.test(text))
  if (!wantsRelease && !wantsClaim && !MENTIONS_AGENTS.test(text)) return undefined
  const scope = await scopeOf($, env)
  if (!scope) return undefined
  const claim = await readClaim($, env, scope)
  const peers = (await listPeers($, env, scope)) ?? []
  if (wantsRelease) {
    if (claim?.surface === env.self) await $.process.run(['rm', '-f', claimFile(env, scope)])
    return `This tab is no longer the main agent for ${scope}.`
  }
  const other = claim && claim.surface !== env.self && peers.some(p => is(p, claim.surface)) ? claim.surface : undefined
  if (wantsClaim && other) {
    const name = peers.find(p => is(p, other))?.name ?? other
    return `${name} (${other}) is already the main agent for ${scope}. Ask the user with AskUserQuestion whether to switch the main agent to this tab ("Switch to this tab (Recommended)" / "Keep ${name}"). On yes call ${MAIN_TOOL} with action claim; that disables ${name} as main.`
  }
  if (wantsClaim) {
    const focus = keepEye ? named(text, peers) : []
    await writeClaim($, env, scope, focus)
    const watching = peers.filter(p => focus.includes(p.id)).map(p => `${p.name} (${p.id})`).join(', ')
    const eye = keepEye ? `\n- Keeping an eye on ${watching || 'every agent (no name matched)'}: every status change of theirs is relayed here; check on them and validate their work when they finish.` : ''
    return mainContext(scope, peers, await approverCmd($)) + eye
  }
  return claim?.surface === env.self ? mainContext(scope, peers, await approverCmd($)) : undefined
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

    await $.tool.register({
      name: SEND_TOOL,
      description: 'Main agent only: type a steering message into another agent tab in this workspace, or close it with close: true.',
      inputSchema: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'The agent id (hc terminal, herdr pane or cmux surface) or its name.' },
          text: { type: 'string', description: 'The message to type into that tab.' },
          close: { type: 'boolean', description: 'True to end that agent and close its tab instead.' },
        },
        required: ['target'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: MAIN_TOOL,
      description: 'Make this tab the main agent of its workspace (action claim, taking over from any current main) or stop being it (release). Claim over another main only after the user said yes.',
      inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['claim', 'release'] } }, required: ['action'] },
      isDeferred: false,
    })

    const driver = driverFor($, env)
    let baseline: Map<string, Peer> | undefined
    let wasMain = false
    const watch = async () => {
      const scope = await scopeOf($, env)
      if (!scope) return
      const claim = await readClaim($, env, scope)
      const isMain = claim?.surface === env.self
      if (wasMain && !isMain) void $.prompt.submit({ text: `[agents] Main agent for ${scope} moved to ${claim?.surface ?? 'nobody'}; this tab no longer steers it.` })
      wasMain = isMain
      if (!isMain) return void (baseline = undefined)
      const peers = await listPeers($, env, scope)
      if (!peers) return
      const subtabs = new Set<string>()
      const runs = `${env.state}/runs`
      if (await $.fs.exists(runs)) {
        for (const run of await $.fs.list(runs)) {
          const meta = await readMeta($, `${runs}/${run.name}`)
          if (meta?.main === env.surface) subtabs.add(meta.child)
        }
      }
      const lines = changes(baseline, peers, subtabs, new Set(claim?.focus ?? []))
      baseline = new Map(peers.map(p => [p.id, p]))
      if (lines.length) void $.prompt.submit({ text: `[agents]\n${lines.join('\n')}` })
    }
    $.clock.every(WATCH_MS, () => void watch().catch(err => $.ui.log(`agent watch failed: ${String(err)}`, { to: 'debug' })))

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
      if (e.text.startsWith('[agents]')) return next({ ...e, context: [...(e.context ?? []), WATCH_CONTEXT] })
      const approver = ((await $.env.get('AGENT_SUBTAB_APPROVER')) ?? '').trim()
      return next({ ...e, context: [...(e.context ?? []), RELAY_CONTEXT, ...(approver ? [approverContext(approver)] : [])] })
    }
    const env = await readEnv($)
    if (env.runId) {
      return next({ ...e, context: [...(e.context ?? []), childContext(`${env.state}/runs/${env.runId}`)] })
    }
    if (env.surface && !e.command) {
      const added = await mainPrompt($, env, e.text)
      if (added) return next({ ...e, context: [...(e.context ?? []), added] })
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

  on('tool.call', { tool: `mcp__agent-orchestration__${MAIN_TOOL}` }, async ($, call) => {
    const e = call as unknown as { action?: string }
    const env = await readEnv($)
    const scope = env.surface && !env.runId ? await scopeOf($, env) : undefined
    if (!scope) return { deny: 'Not in a herdr, Herdr app or cmux workspace this mod can read.' }
    if (e.action === 'release') {
      if ((await readClaim($, env, scope))?.surface === env.self) await $.process.run(['rm', '-f', claimFile(env, scope)])
      return { result: `Released ${scope}.` }
    }
    await writeClaim($, env, scope)
    return { result: mainContext(scope, (await listPeers($, env, scope)) ?? [], await approverCmd($)) }
  })

  on('tool.call', { tool: `mcp__agent-orchestration__${SEND_TOOL}` }, async ($, call) => {
    const e = call as unknown as { target: string; text?: string; close?: boolean }
    const env = await readEnv($)
    const scope = env.surface && !env.runId ? await scopeOf($, env) : undefined
    if (!scope || (await readClaim($, env, scope))?.surface !== env.self) return { deny: 'This tab is not the main agent; the user has to claim it first.' }
    const peers = (await listPeers($, env, scope)) ?? []
    const peer = peers.find(p => is(p, e.target)) ?? peers.find(p => p.name === e.target)
    if (!peer) return { deny: `${e.target} is not a terminal in ${scope}. Known: ${peers.map(p => `${p.name} (${p.id})`).join(', ') || 'none'}` }
    if (e.close) {
      const [host] = scope.split(':')
      const r = host === 'hc'
        ? await $.process.run(['hc', 'kill', peer.id]).then(() => $.process.run(['hc', 'rm', peer.id]))
        : host === 'herdr'
          ? await $.process.run(['herdr', 'pane', 'close', peer.id], { env: { HERDR_SESSION: env.session } })
          : await $.process.run(['cmux', 'close-surface', '--surface', peer.id])
      return r.exitCode === 0 ? { result: `Closed ${peer.name} (${peer.id}).` } : { deny: `close failed: ${r.stderr.trim()}` }
    }
    const flat = (e.text ?? '').replace(/\s*\n\s*/g, ' ').trim()
    if (!flat) return { deny: 'Nothing to send: pass text or close: true.' }
    const failed = await driverFor($, env).send(peer.id, `[main ${env.self}] ${flat}`)
    return failed ? { deny: failed } : { result: `Sent to ${peer.name} (${peer.id}).` }
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
