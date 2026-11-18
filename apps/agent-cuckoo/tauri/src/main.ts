import { getName, getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { createElement, Flag, FolderOpen, Rocket, Send, Settings as Cog, Terminal, Users, type IconNode } from 'lucide';
import * as api from './api';
import { approvalQueue, Board, isGitGrant, mainAgents, mergeReplies, type Group } from './board';
import { IslandFsm } from './fsm';
import { play } from './sounds';
import type { Agent, Approval, Cli, CuckooState, Decision, Reply, Usage } from './types';
import { usageLabel, usageLevel } from './usage';

type Tab = 'agents' | 'super' | 'launch' | 'settings';
type Child = Node | string | null | false | undefined;

const POLL_MS = 2_000;
const INSPIRED_URL = 'https://github.com/Louis-CFM/coucou';
const STATE_EMOJI: Record<Agent['state'], [string, string]> = {
  working: ['working', '🛠️'],
  waiting: ['waiting', '✋'],
  done: ['done', '✅'],
  unknown: ['thinking', '💤'],
};

const ui = {
  tab: 'agents' as Tab,
  state: null as CuckooState | null,
  groups: [] as Group[],
  approvals: [] as Approval[],
  replies: [] as Reply[],
  usage: null as Usage | null,
  clis: [] as Cli[],
  settings: null as api.Settings | null,
  offline: '' as string,
  notice: '' as string,
  target: 'all' as string,
  draft: '',
  launchCwd: '',
  launchPrompt: '',
  launchCli: 'claude',
  emoji: {} as Record<string, string>,
  editing: false,
  about: { name: 'agent-cuckoo', version: '' },
};

const root = document.getElementById('island')!;
const board = new Board();
const fsm = new IslandFsm(
  { set: (fn, ms) => window.setTimeout(fn, ms), clear: (h) => window.clearTimeout(h as number) },
  () => ui.editing || ui.approvals.length > 0,
  () => render(),
);

function h(tag: string, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'value') (el as HTMLInputElement).value = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

const icon = (node: IconNode) => createElement(node, { width: 14, height: 14 }) as unknown as Node;

function emoji(name: string, fallback: () => Node): Node {
  const file = ui.emoji[name];
  if (!file) return fallback();
  const img = h('img', { class: 'emoji', src: `emoji/${file}`, alt: name });
  img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
  return img;
}

function stateBadge(a: Agent): Node {
  const [name, char] = STATE_EMOJI[a.state];
  return emoji(name, () => h('span', { class: 'emoji' }, char));
}

function flash(text: string): void {
  ui.notice = text;
  render();
  window.setTimeout(() => {
    if (ui.notice === text) {
      ui.notice = '';
      render();
    }
  }, 4_000);
}

async function guarded<T>(work: () => Promise<T>, ok?: string): Promise<T | undefined> {
  try {
    const out = await work();
    if (ok) flash(ok);
    return out;
  } catch (e) {
    flash(api.errorText(e));
    return undefined;
  }
}

function pill(agent: Agent, moment: string | null): HTMLElement {
  return h(
    'button',
    {
      class: `pill ${agent.state} ${moment ?? ''} ${agent.canSend ? '' : 'readonly'}`,
      style: agent.colour ? `--accent:${agent.colour}` : null,
      title: [agent.cwd, agent.branch, agent.lastLine].filter(Boolean).join('\n'),
      onclick: () => guarded(() => api.focus(agent.id)),
    },
    stateBadge(agent),
    agent.isMain && h('span', { class: 'main-badge' }, '⚑ MAIN'),
    h('span', { class: 'name' }, agent.codename ? `${agent.codename} · ${agent.name}` : agent.name),
    h('span', { class: 'line' }, agent.lastLine ?? agent.state),
    !agent.canSend && h('span', { class: 'ro' }, 'read-only'),
  );
}

function agentsView(): HTMLElement {
  if (!ui.groups.length) return h('p', { class: 'muted' }, 'No agents found');
  return h(
    'div',
    { class: 'groups' },
    ...ui.groups.map((g) => h('section', {}, h('h3', {}, g.label), ...g.pills.map((p) => pill(p.agent, p.moment)))),
  );
}

async function sendToMains(): Promise<void> {
  const text = ui.draft.trim();
  if (!text || !ui.state) return;
  const mains = mainAgents(ui.state.agents);
  const targets = ui.target === 'all' ? mains : mains.filter((a) => a.id === ui.target);
  if (!targets.length) return flash('No main agent to send to');
  let sent = 0;
  for (const a of targets) if (await guarded(() => api.say(a.id, text))) sent++;
  if (sent) {
    ui.draft = '';
    if (ui.settings?.sounds) play('sent');
    flash(`Sent to ${sent} main agent${sent === 1 ? '' : 's'}`);
  }
}

function superView(): HTMLElement {
  const mains = ui.state ? mainAgents(ui.state.agents) : [];
  return h(
    'div',
    { class: 'panel' },
    h(
      'select',
      { onchange: (e: Event) => (ui.target = (e.target as HTMLSelectElement).value) },
      h('option', { value: 'all', selected: ui.target === 'all' }, `All mains (${mains.length})`),
      ...mains.map((a) => h('option', { value: a.id, selected: ui.target === a.id }, `⚑ ${a.codename ?? a.name} · ${a.space}`)),
    ),
    h('textarea', {
      rows: 3,
      placeholder: 'Instruction for the main agent',
      value: ui.draft,
      oninput: (e: Event) => (ui.draft = (e.target as HTMLTextAreaElement).value),
      onfocus: () => (ui.editing = true),
      onblur: () => (ui.editing = false),
    }),
    h('button', { class: 'primary', onclick: sendToMains, disabled: !mains.length }, icon(Send), 'Send'),
    h(
      'ul',
      { class: 'replies' },
      ...ui.replies
        .slice()
        .reverse()
        .map((r) => h('li', {}, h('b', {}, `${r.codename ?? 'agent'} here: `), r.text)),
    ),
  );
}

function launchView(): HTMLElement {
  const recents = ui.settings?.recents ?? [];
  return h(
    'div',
    { class: 'panel' },
    h(
      'label',
      {},
      icon(FolderOpen),
      h('input', {
        list: 'recents',
        placeholder: 'Project folder',
        value: ui.launchCwd,
        oninput: (e: Event) => (ui.launchCwd = (e.target as HTMLInputElement).value),
        onfocus: () => (ui.editing = true),
        onblur: () => (ui.editing = false),
      }),
    ),
    h('datalist', { id: 'recents' }, ...recents.map((r) => h('option', { value: r }))),
    h(
      'select',
      { onchange: (e: Event) => (ui.launchCli = (e.target as HTMLSelectElement).value) },
      ...ui.clis.map((c) => h('option', { value: c.cli, selected: ui.launchCli === c.cli }, c.cli)),
    ),
    h('textarea', {
      rows: 2,
      placeholder: 'Prompt',
      value: ui.launchPrompt,
      oninput: (e: Event) => (ui.launchPrompt = (e.target as HTMLTextAreaElement).value),
      onfocus: () => (ui.editing = true),
      onblur: () => (ui.editing = false),
    }),
    h(
      'button',
      {
        class: 'primary',
        disabled: !ui.clis.length,
        onclick: async () => {
          const cwd = ui.launchCwd.trim();
          if (!cwd) return flash('Pick a project folder');
          if (await guarded(() => api.launch(cwd, ui.launchPrompt, ui.launchCli), 'Session launched')) {
            ui.settings = (await guarded(() => api.addRecent(cwd))) ?? ui.settings;
            ui.launchPrompt = '';
          }
        },
      },
      icon(Rocket),
      'Launch',
    ),
    h('h3', {}, 'Local CLIs'),
    h(
      'ul',
      { class: 'clis' },
      ...ui.clis.map((c) =>
        h(
          'li',
          {},
          h('b', {}, c.cli),
          ` ${c.version ?? ''} · `,
          c.signedIn === 'unknown' ? 'login unknown' : c.signedIn ? 'signed in' : 'signed out',
        ),
      ),
    ),
    !ui.clis.length && h('p', { class: 'muted' }, 'No agent CLIs found'),
  );
}

function settingsView(): HTMLElement {
  const s = ui.settings;
  if (!s) return h('p', { class: 'muted' }, 'Loading settings');
  const draft = { ...s };
  return h(
    'form',
    {
      class: 'panel',
      onsubmit: async (e: Event) => {
        e.preventDefault();
        ui.settings = (await guarded(() => api.saveSettings(draft), 'Settings saved')) ?? ui.settings;
        void poll();
      },
    },
    h('label', {}, 'agent-monitor URL', h('input', { value: s.monitorUrl, oninput: (e: Event) => (draft.monitorUrl = (e.target as HTMLInputElement).value) })),
    h(
      'label',
      {},
      'Token (blank = read the local token file)',
      h('input', { type: 'password', value: s.token ?? '', oninput: (e: Event) => (draft.token = (e.target as HTMLInputElement).value || null) }),
    ),
    h(
      'label',
      { class: 'row' },
      h('input', { type: 'checkbox', checked: s.sounds, onchange: (e: Event) => (draft.sounds = (e.target as HTMLInputElement).checked) }),
      'Sounds',
    ),
    h('button', { class: 'primary', type: 'submit' }, 'Save'),
    aboutView(),
  );
}

function aboutView(): HTMLElement {
  return h(
    'div',
    { class: 'about' },
    h('h3', {}, 'About'),
    h('p', {}, h('b', {}, ui.about.name), ` ${ui.about.version} · by Snj - nightwalker`),
    h(
      'p',
      {},
      h(
        'a',
        {
          href: INSPIRED_URL,
          onclick: (e: Event) => {
            e.preventDefault();
            void openUrl(INSPIRED_URL).catch(() => flash('Could not open the browser'));
          },
        },
        'Inspired by coucou',
      ),
    ),
  );
}

function approvalCard(a: Approval): HTMLElement {
  const agent = ui.state?.agents.find((x) => x.id === a.agentId);
  const grant = isGitGrant(a.command);
  const decide = (d: Decision) => async () => {
    if (await guarded(() => api.approve(a.id, d))) {
      ui.approvals = ui.approvals.filter((x) => x.id !== a.id);
      render();
    }
  };
  return h(
    'div',
    { class: 'approval' },
    h('div', { class: 'who' }, `${agent?.codename ?? agent?.name ?? a.agentId} wants to run ${a.tool}`),
    h('code', {}, a.command),
    grant
      ? h('p', { class: 'warn' }, 'Answer commit/push in the terminal')
      : h(
          'div',
          { class: 'actions' },
          h('button', { class: 'primary', onclick: decide('allow') }, 'Allow'),
          a.options.length === 3 && h('button', { onclick: decide('always') }, 'Always'),
          h('button', { class: 'danger', onclick: decide('deny') }, 'Deny'),
        ),
    ui.approvals.length > 1 && h('small', { class: 'muted' }, `+${ui.approvals.length - 1} more waiting`),
  );
}

function summary(): HTMLElement {
  const agents = ui.state?.agents ?? [];
  const count = (s: Agent['state']) => agents.filter((a) => a.state === s).length;
  const c = ui.usage?.claude;
  return h(
    'div',
    { class: 'summary', onclick: () => fsm.open() },
    ui.offline ? emoji('sleeping', () => icon(Flag)) : icon(Flag),
    ui.offline ? h('span', { class: 'warn' }, ui.offline) : h('span', {}, `${count('working')} working · ${count('waiting')} waiting`),
    c && h('span', { class: `usage ${usageLevel(c.fiveHour)}`, title: `7 day ${usageLabel(c.sevenDay)}` }, `5h ${usageLabel(c.fiveHour)}`),
  );
}

function tabs(): HTMLElement {
  const t = (id: Tab, node: IconNode, label: string) =>
    h('button', { class: ui.tab === id ? 'tab on' : 'tab', onclick: () => ((ui.tab = id), render()) }, icon(node), label);
  return h('nav', {}, t('agents', Users, 'Agents'), t('super', Terminal, 'Super agent'), t('launch', Rocket, 'Launch'), t('settings', Cog, 'Settings'));
}

function render(): void {
  const mode = fsm.mode;
  root.className = `island ${mode}`;
  const body: Child[] = [summary()];
  if (mode === 'home') {
    if (ui.approvals[0]) body.push(approvalCard(ui.approvals[0]));
    body.push(tabs());
    body.push({ agents: agentsView, super: superView, launch: launchView, settings: settingsView }[ui.tab]());
    if (ui.notice) body.push(h('p', { class: 'notice' }, ui.notice));
  } else if (mode === 'compact' && ui.approvals[0]) {
    body.push(h('p', { class: 'warn' }, 'Approval waiting'));
  }
  const focused = document.activeElement as HTMLElement | null;
  const keep = focused && root.contains(focused) && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA');
  if (keep) return;
  root.replaceChildren(...body.filter((c): c is Node | string => !!c));
  requestAnimationFrame(pushRect);
}

function pushRect(): void {
  const r = root.getBoundingClientRect();
  void api.setHitRect({ x: r.x, y: r.y, w: r.width, h: r.height }).catch(() => {});
}

async function poll(): Promise<void> {
  try {
    const state = await api.getState();
    const before = new Set(ui.approvals.map((a) => a.id));
    ui.state = state;
    ui.offline = '';
    ui.groups = board.update(state.agents, Date.now());
    ui.approvals = approvalQueue(state.approvals);
    ui.replies = mergeReplies(ui.replies, state.replies);
    const moments = ui.groups.flatMap((g) => g.pills.map((p) => p.moment));
    const fresh = ui.approvals.some((a) => !before.has(a.id));
    if (fresh || moments.includes('needs-you') || moments.includes('finished') || state.agents.some((a) => a.state === 'working')) fsm.activity();
    if (ui.settings?.sounds) {
      if (fresh || moments.includes('needs-you')) play('needs-you');
      else if (moments.includes('finished')) play('finished');
    }
  } catch (e) {
    ui.offline = api.errorText(e);
  }
  render();
}

async function slowPoll(): Promise<void> {
  ui.usage = (await api.getUsage().catch(() => null)) ?? ui.usage;
  ui.clis = (await api.getClis().catch(() => null)) ?? ui.clis;
  if (ui.clis.length && !ui.clis.some((c) => c.cli === ui.launchCli)) ui.launchCli = ui.clis[0].cli;
  render();
}

async function start(): Promise<void> {
  ui.settings = await api.getSettings().catch(() => null);
  ui.about = { name: await getName().catch(() => ui.about.name), version: await getVersion().catch(() => '') };
  ui.emoji = await fetch('emoji/index.json')
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  await listen<boolean>('island-hover', (e) => fsm.hover(e.payload));
  render();
  await poll();
  await slowPoll();
  window.setInterval(poll, POLL_MS);
  window.setInterval(slowPoll, 30_000);
}

void start();
