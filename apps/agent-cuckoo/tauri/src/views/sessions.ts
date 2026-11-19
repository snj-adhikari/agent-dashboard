import { ArrowUpRight, FolderOpen, Rocket } from 'lucide';
import * as api from '../api';
import { compareAgents } from '../board';
import type { Agent, Cli } from '../types';
import { agentControls, isExpanded, rowToggle, type RowData } from './agent-controls';
import { h, icon, type Kit } from './cards';
import { miniMascot } from './mascot';
import { sourceLabel } from './overview';
import { t } from '../i18n';

const HOST: Record<Agent['host'], string> = { herdr: 'herdr', 'herdr-app': 'Herdr', cmux: 'cmux', tmux: 'tmux', bare: '' };

export interface HostGroup { host: string; spaces: { space: string; agents: Agent[] }[] }

export const hostLabel = (a: Agent): string => a.hostApp ?? (a.host === 'bare' ? t('sessions.groupOther') : HOST[a.host] ?? a.host);

export function groupSessions(agents: Agent[]): HostGroup[] {
  const hosts = new Map<string, Map<string, Agent[]>>();
  for (const a of [...agents].sort(compareAgents)) {
    const spaces = hosts.get(hostLabel(a)) ?? new Map<string, Agent[]>();
    hosts.set(hostLabel(a), spaces);
    spaces.set(a.space, [...(spaces.get(a.space) ?? []), a]);
  }
  return [...hosts.entries()]
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([host, spaces]) => ({ host, spaces: [...spaces.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([space, list]) => ({ space, agents: list })) }));
}

function row(a: Agent, kit: Kit): HTMLElement {
  return h(
    'div',
    { class: `srow ${a.state} ${a.canSend ? '' : 'readonly'}`, title: [a.cwd, a.branch].filter(Boolean).join('\n'), 'data-agent': a.canSend ? a.id : null, ...rowToggle(a.id, kit) },
    miniMascot(kit.pose(a), a.colour, kit.stateBadge(a), 16),
    a.isMain && h('span', { class: 'main-badge' }, t('common.main')),
    h('span', { class: 'name' }, a.codename ? t('common.agentWithCodename', { codename: a.codename, name: a.name }) : a.name),
    h('span', { class: 'tag' }, kit.badge(`cli-${a.cli ?? ''}`), sourceLabel(a)),
    h('span', { class: 'tag' }, kit.badge(`host-${a.host}`), hostLabel(a)),
    h('span', { class: `status ${a.state}` }, a.state),
    h('span', { class: 'line' }, a.lastLine ?? ''),
    h(
      'button',
      {
        class: 'icon jump-btn',
        title: t('common.jumpToSession'),
        'aria-label': t('common.jumpToSession'),
        disabled: a.canFocus === false,
        onclick: (e: Event) => {
          e.stopPropagation();
          kit.focus(a);
        },
      },
      icon(ArrowUpRight, 12),
    ),
  );
}

/** Agent id of the sendable session row under a drop point (CSS pixels), or null. */
export function dropTarget(el: Element | null): string | null {
  return el?.closest<HTMLElement>('.srow[data-agent]')?.dataset.agent ?? null;
}

export function sessionsView(agents: Agent[], kit: Kit, board: RowData = { approvals: [], replies: [] }): HTMLElement {
  if (!agents.length) return h('p', { class: 'muted panel' }, t('common.noAgentsFound'));
  return h(
    'div',
    { class: 'groups' },
    ...groupSessions(agents).map((g) =>
      h('section', {}, h('h3', {}, g.host), ...g.spaces.map((s) => h('div', { class: 'space' }, h('h4', {}, s.space), ...s.agents.flatMap((a) => [row(a, kit), isExpanded(a.id) && agentControls(a, board, kit)])))),
    ),
  );
}

export const launchClis = (clis: Cli[]): Cli[] => clis.filter((c) => c.signedIn === true);

const launch = { cwd: '', prompt: '', cli: '' };

export function launchView(clis: Cli[], recents: string[], kit: Kit, onRecents: (dir: string) => void): HTMLElement {
  const usable = launchClis(clis);
  if (!usable.some((c) => c.cli === launch.cli)) launch.cli = usable[0]?.cli ?? '';
  return h(
    'div',
    { class: 'panel' },
    h(
      'div',
      { class: 'inline' },
      icon(FolderOpen),
      h('input', { list: 'recents', placeholder: t('launch.projectFolder'), value: launch.cwd, oninput: (e: Event) => (launch.cwd = (e.target as HTMLInputElement).value), ...kit.editable }),
      h('select', { onchange: (e: Event) => (launch.cli = (e.target as HTMLSelectElement).value) }, ...usable.map((c) => h('option', { value: c.cli, selected: launch.cli === c.cli }, c.cli))),
    ),
    h('datalist', { id: 'recents' }, ...recents.map((r) => h('option', { value: r }))),
    h(
      'div',
      { class: 'inline' },
      h('input', { placeholder: t('launch.prompt'), value: launch.prompt, oninput: (e: Event) => (launch.prompt = (e.target as HTMLInputElement).value), ...kit.editable }),
      h(
        'button',
        {
          class: 'primary',
          disabled: !usable.length,
          onclick: async () => {
            const cwd = launch.cwd.trim();
            if (!cwd) return kit.flash(t('launch.pickFolder'));
            if (await kit.guarded(() => api.launch(cwd, launch.prompt, launch.cli), t('status.sessionLaunched'))) {
              launch.prompt = '';
              onRecents(cwd);
            }
          },
        },
        icon(Rocket),
        t('launch.launch'),
      ),
    ),
    !usable.length && h('p', { class: 'muted' }, t('launch.noCli')),
  );
}
