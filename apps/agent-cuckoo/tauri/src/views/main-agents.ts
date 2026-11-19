import { Send } from 'lucide';
import * as api from '../api';
import { mainAgents, replyKind } from '../board';
import { play } from '../sounds';
import type { Agent, Approval, Reply } from '../types';
import { approvalCard, h, icon, type Kit } from './cards';
import { miniMascot } from './mascot';
import { agentControls, isExpanded, pruneReplies, replyText, rowToggle } from './agent-controls';
import { t } from '../i18n';

export function mainRows(agents: Agent[]): Agent[] {
  const seen = new Set<string>();
  return mainAgents(agents).filter((a) => !seen.has(a.space) && seen.add(a.space));
}

export function splitReplies(replies: Reply[], answered: ReadonlySet<string>): { asks: Reply[]; replies: Reply[] } {
  const newest = [...replies].reverse();
  return { asks: newest.filter((r) => replyKind(r) === 'ask' && !answered.has(r.id)), replies: newest.filter((r) => replyKind(r) !== 'ask') };
}

const drafts = new Map<string, string>();
const answered = new Set<string>();

async function sendTo(agentId: string, key: string, kit: Kit): Promise<boolean> {
  const text = (drafts.get(key) ?? '').trim();
  if (!text) return false;
  if (!(await kit.guarded(() => api.say(agentId, text), t('common.sent')))) return false;
  drafts.delete(key);
  play('send');
  (document.activeElement as HTMLElement | null)?.blur();
  kit.render();
  return true;
}

function composer(key: string, agentId: string, placeholder: string, kit: Kit, after: () => void = () => {}): HTMLElement {
  const go = async () => (await sendTo(agentId, key, kit)) && after();
  return h(
    'div',
    { class: 'inline' },
    h('input', {
      placeholder,
      value: drafts.get(key) ?? '',
      oninput: (e: Event) => drafts.set(key, (e.target as HTMLInputElement).value),
      onkeydown: (e: KeyboardEvent) => e.key === 'Enter' && void go(),
      ...kit.editable,
    }),
    h('button', { class: 'primary', type: 'button', 'aria-label': t('common.send'), onclick: () => void go() }, icon(Send)),
  );
}

export interface MainsData { agents: Agent[]; replies: Reply[]; approvals: Approval[] }

export function mainsView(d: MainsData, kit: Kit, onApproved: (id: string) => void): HTMLElement {
  const rows = mainRows(d.agents);
  const byId = new Map(d.agents.map((a) => [a.id, a]));
  const ours = d.approvals.filter((a) => byId.get(a.agentId)?.isMain);
  const { asks, replies } = splitReplies(d.replies, answered);
  pruneReplies(replies);
  if (!rows.length) return h('p', { class: 'muted panel' }, t('mains.none'));
  return h(
    'div',
    { class: 'panel mains' },
    ...ours.map((a, i) => approvalCard(a, i, ours.length, byId.get(a.agentId), kit, onApproved)),
    ...asks.map((r) =>
      h(
        'div',
        { class: 'approval question ask' },
        h('div', { class: 'who' }, h('span', {}, t('mains.asks', { name: r.from ?? t('mains.subAgent') })), h('span', { class: 'count' }, t('mains.via', { name: r.codename ?? t('mains.main') }))),
        h('p', { class: 'question' }, r.text),
        composer(`ask:${r.id}`, r.agentId, t('common.answer'), kit, () => answered.add(r.id)),
      ),
    ),
    ...rows.map((a) =>
      h(
        'div',
        { class: 'mrow' },
        h(
          'div',
          { class: 'mhead', ...rowToggle(a.id, kit) },
          miniMascot(kit.pose(a), a.colour, kit.stateBadge(a), 16),
          h('span', { class: 'main-badge' }, t('common.main')),
          h('span', { class: 'name' }, a.codename ?? a.name),
          h('span', { class: 'muted' }, a.space),
          h('span', { class: `status ${a.state}` }, a.state),
        ),
        isExpanded(a.id) ? agentControls(a, d, kit) : composer(`main:${a.id}`, a.id, t('mains.instructionFor', { name: a.codename ?? a.name }), kit),
      ),
    ),
    replies.length > 0 &&
      h(
        'ul',
        { class: 'replies' },
        ...replies.map((r) => {
          const body = replyText(r, kit, 'reply-text');
          return h('li', {}, h('div', { class: 'reply-head' }, h('b', {}, t('mains.hereShort', { name: r.codename ?? t('mains.agent') })), body.toggle), body.text);
        }),
      ),
  );
}
