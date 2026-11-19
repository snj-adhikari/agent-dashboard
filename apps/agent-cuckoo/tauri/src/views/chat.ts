/// <reference types="vite/client" />
import { RotateCcw, Send } from 'lucide';
import '../views.css';
import './chat.css';
import * as api from '../api';
import { cards, isLong } from '../cardExpansion';
import { chatKey } from '../chatKeys';
import { greeting } from '../greeting';
import { play } from '../sounds';
import { superviseFeed, type FeedTarget } from '../superviseFeed';
import type { ApiError, Cli, Reply, SupervisePending, SuperviseResponse } from '../types';
import { chevron, h, icon, toggleCard, type Kit } from './cards';
import type { MascotPose } from './mascot';
import { t } from '../i18n';

export type ChatMood = 'idle' | 'thinking' | 'happy' | 'error';
export interface Msg { id: string; role: 'greeting' | 'user' | 'assistant' | 'reply' | 'ask'; text: string; agentId?: string; name?: string }

const HAPPY_MS = 2_500;
const MOOD_POSE: Record<ChatMood, MascotPose | null> = { idle: null, thinking: 'thinking', happy: 'happy', error: 'alarmed' };

export const chatClis = (clis: Cli[]): Cli[] => clis.filter((c) => c.chat === true && c.signedIn === true);
export const chatPose = (m: ChatMood): MascotPose | null => MOOD_POSE[m];

const chat = {
  msgs: [] as Msg[],
  conversationId: null as string | null,
  cli: '',
  mood: 'idle' as ChatMood,
  busy: false,
  pending: null as SupervisePending | null,
  watch: { targets: [] as FeedTarget[], since: 0 },
  seen: new Set<string>(),
  answered: new Set<string>(),
};
let seq = 0;
const INPUT_MAX_H = 96;
let root: HTMLElement | null = null;
let log: HTMLElement;
let chips: HTMLElement;
let confirmRow: HTMLElement;
let input: HTMLTextAreaElement;
let sendBtn: HTMLButtonElement;
let kitRef: Kit;

export const chatMood = (): ChatMood => chat.mood;
export const chatCardIds = (): string[] => chat.msgs.map((m) => `chat:${m.id}`);

const push = (m: Omit<Msg, 'id'>): void => void chat.msgs.push({ ...m, id: `m${++seq}` });

function answerForm(m: Msg): HTMLElement {
  const field = h('input', { class: 'chat-input', placeholder: t('supervise.answer'), ...kitRef.editable }) as HTMLInputElement;
  const answer = async () => {
    const text = field.value.trim();
    if (!text || !m.agentId) return;
    if ((await kitRef.guarded(() => api.say(m.agentId!, text))) === undefined) return;
    chat.answered.add(m.id);
    push({ role: 'user', text });
    play('send');
    paintLog();
  };
  field.addEventListener('keydown', (e) => chatKey(e) === 'send' && (e.preventDefault(), void answer()));
  return h('div', { class: 'inline' }, field, h('button', { type: 'button', class: 'primary', onclick: () => void answer() }, t('supervise.answer')));
}

function bubble(m: Msg): HTMLElement {
  const id = `chat:${m.id}`;
  const long = m.role !== 'user' && m.role !== 'greeting' && isLong(m.text);
  const open = !long || cards.isOpen(id);
  const head = m.role === 'reply' ? t('supervise.replyFrom', { name: m.name ?? '' }) : m.role === 'ask' ? t('supervise.askFrom', { name: m.name ?? '' }) : null;
  const toggle = long ? chevron(id, open, () => paintLog()) : null;
  return h(
    'div',
    { class: `chat-bubble ${m.role}`, 'data-card': id },
    (head || toggle) && h('div', { class: 'bubble-head' }, head && h('span', {}, head), toggle),
    h('div', { class: open ? 'bubble-text' : 'bubble-text clamped', onclick: long ? () => toggleCard(id, () => paintLog()) : undefined }, m.text),
    m.role === 'ask' && !chat.answered.has(m.id) && answerForm(m),
  );
}

function paintConfirm(): void {
  const p = chat.pending;
  confirmRow.replaceChildren(
    ...(p
      ? [
          h('span', { class: 'confirm-summary' }, t('supervise.confirmSummary', { summary: p.summary })),
          h('button', { type: 'button', class: 'chip', disabled: chat.busy, onclick: () => void confirm(true) }, t('supervise.cancel')),
          h('button', { type: 'button', class: 'chip on', disabled: chat.busy, onclick: () => void confirm(false) }, t('supervise.confirm')),
        ]
      : []),
  );
  confirmRow.hidden = !p;
}

let painted = '';

function paintLog(): void {
  input.placeholder = t(chat.msgs.length ? 'supervise.placeholder' : 'chat.placeholder');
  sendBtn.disabled = chat.busy;
  const hello = greeting(new Date().getHours());
  const key = JSON.stringify([chat.msgs.length, chat.mood, chat.busy, cards.rev, chat.answered.size, chat.pending?.confirmId, hello]);
  if (key === painted) return;
  painted = key;
  const dots = chat.mood === 'thinking' ? [h('div', { class: 'typing', 'aria-label': t('chat.thinking') }, h('i'), h('i'), h('i'))] : [];
  log.replaceChildren(bubble({ id: 'greeting', role: 'greeting', text: hello }), ...chat.msgs.map(bubble), ...dots);
  log.scrollTop = log.scrollHeight;
  paintConfirm();
}

function absorbFeed(replies: readonly Reply[]): void {
  for (const f of superviseFeed(replies, chat.watch.targets, chat.watch.since, chat.seen)) {
    chat.seen.add(f.id);
    push({ role: f.kind, text: f.text, agentId: f.agentId, name: f.name });
  }
}

function endConversation(): void {
  if (chat.conversationId) void api.chatEnd(chat.conversationId).catch(() => {});
  chat.conversationId = null;
}

export function resetChat(): void {
  endConversation();
  chat.msgs = [];
  chat.mood = 'idle';
  chat.pending = null;
  chat.watch = { targets: [], since: 0 };
  if (root) paintLog();
}

function setMood(m: ChatMood, onMood: (m: ChatMood) => void): void {
  chat.mood = m;
  paintLog();
  onMood(m);
  kitRef.render();
}

/** Shows the server's reply, holds a pending action for Confirm, and watches the agents a send reached. */
function apply(res: SuperviseResponse): void {
  chat.conversationId = res.conversationId;
  if (res.text) push({ role: 'assistant', text: res.text });
  if (res.results.some((r) => r.error === 'grant_in_terminal')) push({ role: 'assistant', text: t('supervise.answerInTerminal') });
  chat.pending = res.pending;
  if (res.intent !== 'send' || res.pending) return;
  const failed = new Set(res.results.filter((r) => !r.ok).map((r) => r.agentId));
  const reached = res.targets.filter((x) => !failed.has(x.agentId));
  if (!reached.length) return;
  const keep = chat.watch.targets.filter((x) => !reached.some((r) => r.agentId === x.agentId));
  chat.watch = { targets: [...keep, ...reached], since: chat.watch.targets.length ? chat.watch.since : Date.now() };
}

async function run(work: () => Promise<void>, onMood: (m: ChatMood) => void): Promise<void> {
  chat.busy = true;
  setMood('thinking', onMood);
  try {
    await work();
    chat.busy = false;
    setMood('happy', onMood);
    window.setTimeout(() => chat.mood === 'happy' && setMood('idle', onMood), HAPPY_MS);
  } catch (e) {
    chat.busy = false;
    if ((e as Partial<ApiError>)?.error === 'stale' && !chat.pending) push({ role: 'assistant', text: t('supervise.expired') });
    else kitRef.flash(api.errorText(e));
    setMood('error', onMood);
  }
}

let moodRef: (m: ChatMood) => void = () => {};

async function confirm(cancel: boolean): Promise<void> {
  const p = chat.pending;
  if (!p || chat.busy) return;
  chat.pending = null;
  if (!cancel && Date.now() > p.expiresAt) {
    push({ role: 'assistant', text: t('supervise.expired') });
    paintLog();
    return;
  }
  await run(async () => apply(await api.superviseConfirm(p.confirmId, cancel)), moodRef);
}

async function send(): Promise<void> {
  const text = input.value.trim();
  if (!text || chat.busy) return;
  input.value = '';
  fit();
  push({ role: 'user', text });
  chat.pending = null;
  play('send');
  await run(async () => {
    if (api.attachments().length && chat.cli) {
      const res = await api.chat(chat.cli, text, chat.conversationId);
      chat.conversationId = res.conversationId;
      push({ role: 'assistant', text: res.text });
      return;
    }
    apply(await api.supervise(text, chat.conversationId, chat.cli || null));
  }, moodRef);
}

function paintChips(clis: Cli[]): void {
  const usable = chatClis(clis);
  if (!usable.some((c) => c.cli === chat.cli)) {
    if (chat.cli) endConversation();
    chat.cli = usable[0]?.cli ?? '';
  }
  chips.replaceChildren(
    ...usable.map((c) =>
      h(
        'button',
        {
          class: c.cli === chat.cli ? 'chip on' : 'chip',
          type: 'button',
          onclick: () => {
            if (c.cli === chat.cli) return;
            endConversation();
            chat.cli = c.cli;
            play('pop');
            paintChips(clis);
          },
        },
        h('i', { class: 'chip-dot' }),
        c.cli,
      ),
    ),
    ...(usable.length ? [] : [h('span', { class: 'muted' }, t('chat.noCli'))]),
  );
}

/** Built once and kept, so typing and replies survive the island's re-renders. Replies from agents a send reached stream in as tagged bubbles. */
export function chatView(clis: Cli[], replies: readonly Reply[], kit: Kit, onMood: (m: ChatMood) => void): HTMLElement {
  kitRef = kit;
  moodRef = onMood;
  if (!root) {
    log = h('div', { class: 'chat-log' });
    chips = h('div', { class: 'chips' });
    confirmRow = h('div', { class: 'confirm-row', hidden: true });
    input = h('textarea', { class: 'chat-input', rows: 1, oninput: fit, ...kit.editable }) as HTMLTextAreaElement;
    input.addEventListener('keydown', (e) => {
      if (chatKey(e) !== 'send') return;
      e.preventDefault();
      void send();
    });
    sendBtn = h('button', { class: 'primary round', type: 'button', 'aria-label': t('common.send'), onclick: () => void send() }, icon(Send)) as HTMLButtonElement;
    const fresh = h('button', { class: 'icon', type: 'button', title: t('chat.newChat'), 'aria-label': t('chat.newChat'), onclick: () => resetChat() }, icon(RotateCcw, 12));
    root = h('div', { class: 'chat' }, log, confirmRow, h('div', { class: 'chip-row' }, chips, fresh), h('div', { class: 'inline' }, input, sendBtn));
  }
  absorbFeed(replies);
  paintChips(clis);
  paintLog();
  return root;
}

function fit(): void {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, INPUT_MAX_H)}px`;
}

export const focusChatInput = (): void => input?.focus();

globalThis.addEventListener?.('beforeunload', endConversation);
