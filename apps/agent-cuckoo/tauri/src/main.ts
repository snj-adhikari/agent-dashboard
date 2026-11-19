import { getName, getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Flag,
  Hourglass,
  House,
  Inbox,
  LayoutList,
  MessageCircle,
  Mic,
  Music as MusicIcon,
  Paperclip,
  Timer as TimerIcon,
  Rocket,
  Settings as Cog,
  Volume2,
  VolumeX,
  X,
  type IconNode,
} from 'lucide';
import * as api from './api';
import { approvalKind, approvalQueue, Board, mergeReplies, SessionBoard, type Group, type SessionPill, type Slots } from './board';
import { IslandFsm, type Mode } from './fsm';
import { guideDue, recapDue } from './gates';
import { resolveOutfit, type Outfit } from './outfit';
import { pause as pauseTimer, reset as resetTimer, running, start as startTimer, tick as tickTimer, type TimerState } from './timer';
import { DANCE_FRAME_MS } from './reaction';
import { closeEase, motion, prefersReducedMotion, springAt, type Motion } from './motion';
import { poseOf, reaction, type Reaction } from './reaction';
import { configure as configureSounds, play } from './sounds';
import type { Agent, Approval, ApiError, Cli, CuckooState, RecapResponse, Reply, SideDataResponse, SideId, SideProvider, SideSettings, UploadResponse, Usage } from './types';
import { usageLabel, usageLevel } from './usage';
import { Mascot, miniMascot, type MascotPose } from './views/mascot';
import { overview, Steps } from './views/overview';
import { approvalCard, h, icon, type Kit } from './views/cards';
import { cards, islandHeight } from './cardExpansion';
import { chatCardIds, chatMood, chatPose, chatView, focusChatInput } from './views/chat';
import { guideView } from './views/guide';
import { dropTarget, launchView, sessionsView } from './views/sessions';
import { chooseView, dropIntoSession, dropView, type Dropped, type DropHooks } from './views/drop';
import { startUpload, uploadView, type UploadRun } from './views/upload';
import { mailView } from './views/mail';
import { messagesView } from './views/messages';
import { portfolioView } from './views/portfolio';
import { SERVICES, servicesView, type SideDeps } from './views/services';
import { musicPill, musicPose, musicReveal, musicView } from './views/music';
import { loadTimer, saveTimer, timerPill, timerPose, timerView } from './views/timer';
import { recapCard } from './views/recap';
import { scheduleWhatsNew, whatsNewPose, whatsNewView } from './views/whats-new';
import { outfitOverlay, outfitPrefs, wardrobeView } from './views/wardrobe';
import { LISTENING_POSE, listeningView, voiceAvailable } from './views/listening';
import { UPLOAD_POSE } from './uploadTimeline';
import { mainsView } from './views/main-agents';
import { fsmOptions, settingsView, sideOn, soundOptions } from './views/settings';
import { t } from './i18n';

type Tab = 'home' | 'chat' | 'sessions' | 'mains' | 'launch' | 'settings' | 'drop' | 'upload' | 'choose' | 'side' | 'music' | 'timer' | 'wardrobe' | 'recap' | 'whatsnew' | 'listening' | 'guide';
type SideCard = 'mail' | 'whatsapp' | 'crypto' | 'services';
interface Shape { w: number; h: number; r: number }

const POLL_MS = 2_000;
const TICK_MS = DANCE_FRAME_MS;
const DROP_H = 8 + 34 + 176 + 10;
const TALL_H = 300;
const HOME_H: Partial<Record<Tab, number>> = { drop: DROP_H, upload: DROP_H, choose: DROP_H, side: TALL_H, settings: TALL_H, recap: TALL_H, whatsnew: TALL_H, guide: TALL_H, wardrobe: TALL_H, timer: 220, sessions: 260, mains: 280 };
const MASCOT_TABS: ReadonlySet<Tab> = new Set<Tab>(['home', 'chat', 'music', 'timer', 'listening', 'whatsnew']);
const CARD_IDS: SideId[] = ['mail', 'whatsapp', 'crypto', ...SERVICES.map(([id]) => id)];
const DEFAULT_NOTES = [t('greeting.featureDrop'), t('greeting.featureSide'), t('greeting.featureClock')];
const PANEL_W = 720;
const SIZE: Record<Mode, Shape> = {
  hidden: { w: 80, h: 24, r: 14 },
  compact: { w: 240, h: 24, r: 14 },
  home: { w: 640, h: 160, r: 22 },
};
const WASH: Record<Reaction, string> = {
  error: 'rgba(244,80,94,0.55)',
  done: 'rgba(52,211,153,0.50)',
  celebrating: 'rgba(52,211,153,0.50)',
  waiting: 'rgba(245,165,36,0.42)',
  thinking: 'rgba(34,211,238,0.38)',
  working: 'rgba(99,102,241,0.50)',
  sleeping: 'rgba(255,255,255,0.08)',
};

const ui = {
  tab: 'home' as Tab,
  state: null as CuckooState | null,
  groups: [] as Group[],
  slots: { pills: [], waitingMore: 0 } as Slots,
  focusKey: null as string | null,
  approvals: [] as Approval[],
  replies: [] as Reply[],
  usage: null as Usage | null,
  clis: [] as Cli[],
  settings: null as api.Settings | null,
  offline: '',
  notice: '',
  emoji: {} as Record<string, string>,
  editing: false,
  reduced: prefersReducedMotion(),
  about: { name: 'agent-cuckoo', version: '' },
  side: { providers: null as SideProvider[] | null, settings: null as SideSettings | null, data: {} as Partial<Record<SideId, SideDataResponse>> },
  sideCard: 'mail' as SideCard,
  timer: loadTimer() as TimerState,
  upload: null as UploadRun | null,
  dropped: null as Dropped | null,
  recap: null as RecapResponse | null,
  whatsNew: { page: 1 as 1 | 2, notes: DEFAULT_NOTES, stats: null as RecapResponse | null },
  transcript: '',
  guidePage: 0,
};

const fx = (): Motion => motion(ui.reduced);
const root = document.getElementById('island')!;
const shapeEl = root.querySelector<HTMLElement>('.shape')!;
const compactEl = root.querySelector<HTMLElement>('.layer.compact')!;
const homeEl = root.querySelector<HTMLElement>('.layer.home')!;
const board = new Board();
const sessions = new SessionBoard();
const steps = new Steps();
const bigMascot = new Mascot(58, fx);
const smallMascot = new Mascot(20, fx);

const fsm = new IslandFsm(
  { set: (fn, ms) => window.setTimeout(fn, ms), clear: (h) => window.clearTimeout(h as number) },
  () => ui.editing || ui.approvals.length > 0,
  (from, to) => {
    if (to === 'home') play('open');
    else if (from === 'home') play('close');
    morph(to);
    render();
  },
);

const smallIcon = (name: 'jump' | 'wait' | 'check' | 'chev') => icon({ jump: ArrowUpRight, wait: Hourglass, check: Check, chev: ChevronRight }[name], name === 'jump' ? 8 : 10);

function badge(name: string): Node | null {
  const file = ui.emoji[name];
  if (!file) return null;
  const img = h('img', { class: 'emoji', src: `emoji/${file}`, alt: '' });
  img.addEventListener('error', () => img.remove(), { once: true });
  return img;
}


let fitH: number | null = null;
const collapsed = (): boolean => ui.settings?.islandCollapsed ?? false;
const FIT_TABS = new Set<Tab>(['home', 'sessions', 'mains']);
const homeH = (): number => islandHeight({ base: HOME_H[ui.tab] ?? SIZE.home.h, content: FIT_TABS.has(ui.tab) ? fitH : null, collapsed: collapsed(), max: window.innerHeight || SIZE.home.h });
const sizeOf = (mode: Mode): Shape => (mode === 'home' ? { ...SIZE.home, h: homeH() } : SIZE[mode]);

let shape: Shape = { ...sizeOf(fsm.mode) };
let target: Shape = shape;
let anim = 0;

function applyShape(s: Shape): void {
  const side = (PANEL_W - s.w) / 2;
  shapeEl.style.clipPath = `inset(0px ${side}px calc(100% - ${s.h}px) ${side}px round 0px 0px ${s.r}px ${s.r}px)`;
}

function pushRect(s: Shape): void {
  void api.setHitRect({ x: (PANEL_W - s.w) / 2, y: 0, w: s.w, h: s.h }).catch(() => {});
}

function morph(to: Mode): void {
  const start = { ...shape };
  const end = sizeOf(to);
  target = end;
  homeEl.style.height = `${sizeOf('home').h}px`;
  const m = fx();
  const grow = end.w * end.h >= start.w * start.h;
  pushRect(grow ? end : start);
  layers(to, m);
  cancelAnimationFrame(anim);
  if (m.open.kind === 'fade') {
    shape = { ...end };
    applyShape(shape);
    pushRect(end);
    return;
  }
  const t0 = performance.now();
  const mix = (p: number): Shape => ({ w: start.w + (end.w - start.w) * p, h: start.h + (end.h - start.h) * p, r: start.r + (end.r - start.r) * p });
  const step = (now: number) => {
    const t = (now - t0) / 1000;
    let p: number;
    let done: boolean;
    if (grow && m.open.kind === 'spring') {
      p = springAt(m.open, t);
      done = t > m.open.response && Math.abs(1 - p) < 0.002;
    } else {
      const ms = m.close.kind === 'curve' ? m.close.ms : 340;
      p = closeEase(Math.min(1, (t * 1000) / ms));
      done = t * 1000 >= ms;
    }
    shape = done ? { ...end } : mix(p);
    applyShape(shape);
    if (done) pushRect(end);
    else anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}

function fade(el: HTMLElement, show: boolean, m: Motion): void {
  if (el.classList.contains('on') === show) return;
  el.classList.toggle('on', show);
  if (show) {
    el.animate(
      m.bob ? [{ opacity: 0, transform: 'scale(0.97)', filter: 'blur(8px)' }, { opacity: 1, transform: 'none', filter: 'none' }] : [{ opacity: 0 }, { opacity: 1 }],
      { duration: m.contentInMs, delay: m.contentInDelayMs, easing: 'ease-out', fill: 'backwards' },
    );
  } else if (m.contentOutMs > 0) {
    el.animate(
      [{ opacity: 1, transform: 'none', filter: 'none' }, { opacity: 0, transform: 'scale(0.97)', filter: 'blur(8px)' }],
      { duration: m.contentOutMs, easing: 'ease-in' },
    );
  } else {
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: m.contentInMs, easing: 'ease' });
  }
}

function layers(mode: Mode, m: Motion): void {
  fade(compactEl, mode === 'compact', m);
  fade(homeEl, mode === 'home', m);
}


function focusedPill(): SessionPill | null {
  const pills = ui.slots.pills;
  return pills.find((p) => p.key === ui.focusKey) ?? pills.find((p) => p.urgency === 'waiting') ?? pills[0] ?? null;
}

function reactionOf(a: Agent | null): Reaction {
  return reaction(a, { now: Date.now(), offline: !!ui.offline, justFinished: !!a && ui.groups.some((g) => g.pills.some((p) => p.agent.id === a.id && p.moment === 'finished')) });
}

const pose = (a: Agent): MascotPose => poseOf(reactionOf(a));


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

const editable = { onfocus: () => (ui.editing = true), onblur: () => (ui.editing = false) };

const kit: Kit = {
  badge,
  pose,
  stateBadge: (a) => badge(reactionOf(a)),
  guarded,
  flash,
  render: () => render(),
  focus: (a) => void guarded(() => api.focus(a.id)),
  editable,
};

function applySettings(s: api.Settings | null): void {
  configureSounds(soundOptions(s));
  Object.assign(fsm.options, fsmOptions(s));
  if (s) void api.desktopMascot(s.desktopMascot ?? false).catch(() => {});
}

async function saveSettings(next: api.Settings, ok?: string): Promise<void> {
  applySettings(next);
  ui.settings = { ...next, ...(await guarded(() => api.saveSettings(next), ok)) };
  render();
  if (ok) void poll();
}

function saveLocal(s: api.Settings): void {
  ui.settings = { ...ui.settings, ...s };
  render();
}

function dropApproval(id: string): void {
  ui.approvals = ui.approvals.filter((x) => x.id !== id);
  render();
}

const agentOf = (id: string): Agent | undefined => ui.state?.agents.find((a) => a.id === id);


function header(): HTMLElement {
  const tab = (id: Tab, node: IconNode, label: string) =>
    h('button', { class: ui.tab === id ? 'tab on' : 'tab', title: label, 'aria-label': label, onclick: () => ((ui.tab = id), render()) }, icon(node));
  const c = ui.usage?.claude;
  const sounds = ui.settings?.sounds ?? true;
  return h(
    'header',
    {},
    h(
      'nav',
      {},
      tab('home', House, t('tab.home')),
      tab('chat', MessageCircle, t('tab.chat')),
      tab('sessions', LayoutList, t('tab.sessions')),
      tab('mains', Flag, t('tab.mainAgents')),
      tab('launch', Rocket, t('tab.launch')),
      tab('drop', Paperclip, t('tab.drop')),
      tab('side', Inbox, t('tab.sideCards')),
      ui.state?.music && tab('music', MusicIcon, t('tab.music')),
      tab('timer', TimerIcon, t('tab.cuckooClock')),
    ),
    h(
      'div',
      { class: 'tools' },
      ui.tab === 'home' && c && h('span', { class: `usage ${usageLevel(c.fiveHour)}`, title: t('usage.sevenDay', { value: usageLabel(c.sevenDay) }) }, t('usage.fiveHour', { value: usageLabel(c.fiveHour) })),
      voice && h('button', { class: fsm.listening ? 'icon on' : 'icon', title: t('tab.holdToTalk'), 'aria-label': t('tab.holdToTalk'), onpointerdown: startVoice, onpointerup: stopVoice, onpointerleave: stopVoice }, icon(Mic)),
      h('button', { class: 'icon', title: t('common.settings'), 'aria-label': t('common.settings'), onclick: () => ((ui.tab = 'settings'), render()) }, icon(Cog)),
      h('button', { class: 'icon', title: sounds ? t('common.mute') : t('common.unmute'), 'aria-label': t('common.sound'), onclick: toggleSound }, icon(sounds ? Volume2 : VolumeX)),
      islandToggle(),
      h('button', { class: 'icon', title: t('common.close'), 'aria-label': t('common.close'), onclick: () => fsm.esc() }, icon(X)),
    ),
  );
}

function islandToggle(): HTMLElement {
  const shut = collapsed();
  const label = t(shut ? 'island.expand' : 'island.collapse');
  return h('button', { class: 'icon', title: label, 'aria-label': label, 'aria-expanded': String(!shut), onclick: () => ui.settings && void saveSettings({ ...ui.settings, islandCollapsed: !shut }) }, icon(shut ? ChevronDown : ChevronUp));
}

const voice = voiceAvailable();
interface Recogniser { interimResults: boolean; continuous: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; start(): void; stop(): void }
let recogniser: Recogniser | null = null;

/** Push-to-talk: the webview's own speech recognition; hidden when the webview has none. */
function startVoice(): void {
  if (!voice || recogniser) return;
  const g = globalThis as unknown as Record<string, new () => Recogniser>;
  const rec = new (g.SpeechRecognition ?? g.webkitSpeechRecognition)();
  rec.interimResults = true;
  rec.continuous = true;
  ui.transcript = '';
  rec.onresult = (e) => {
    ui.transcript = Array.from(e.results, (r) => r[0]?.transcript ?? '').join(' ').trim();
    render();
  };
  rec.onend = () => {
    recogniser = null;
    fsm.voiceFinished();
    const text = ui.transcript;
    ui.tab = 'chat';
    render();
    const input = homeEl.querySelector<HTMLInputElement>('.chat-input');
    if (input && text) {
      input.value = text;
      input.focus();
    }
  };
  try {
    rec.start();
  } catch (e) {
    flash(api.errorText(e));
    return;
  }
  recogniser = rec;
  play('listen');
  fsm.voiceWoke();
  fsm.open();
  ui.tab = 'listening';
  render();
}

function stopVoice(): void {
  recogniser?.stop();
}

const sideDeps: SideDeps = {
  get providers() {
    return ui.side.providers;
  },
  get settings() {
    return ui.side.settings;
  },
  get data() {
    return ui.side.data;
  },
  refresh: (id) => refreshSide(id),
  action: async (id, action, itemId, text) => (await api.sideAction(id, action, itemId, text)).result,
  render: () => render(),
};

const usable = (id: SideId): boolean => sideOn(ui.side.settings, id) && !!ui.side.providers?.find((p) => p.id === id && p.available && !p.reason);

async function refreshSide(id: SideId | null): Promise<void> {
  const ids = id ? [id] : CARD_IDS.filter(usable);
  await Promise.all(
    ids.map((x) =>
      api.getSideData(x).then(
        (d) => void (ui.side.data = { ...ui.side.data, [x]: d }),
        () => {},
      ),
    ),
  );
}

async function loadSide(): Promise<void> {
  const r = await api.getSide().catch(() => null);
  ui.side.providers = r?.providers ?? null;
  ui.side.settings = r?.settings ?? null;
  await refreshSide(null);
}

async function saveSide(patch: Partial<SideSettings>): Promise<void> {
  const r = await guarded(() => api.saveSideSettings(patch), t('status.settingsSaved'));
  if (r) {
    ui.side.providers = r.providers;
    ui.side.settings = r.settings;
    void refreshSide(null).then(render);
  }
  render();
}

function sideView(): HTMLElement {
  const cards: [SideCard, string][] = [['mail', t('tab.mail')], ['whatsapp', 'WhatsApp'], ['crypto', t('tab.portfolio')], ['services', t('tab.services')]];
  const view = { mail: mailView, whatsapp: (d: SideDeps) => messagesView(d, editable), crypto: portfolioView, services: servicesView }[ui.sideCard];
  return h(
    'div',
    { class: 'panel side-tab' },
    h(
      'div',
      { class: 'srow-set' },
      ...cards.map(([id, label]) => h('button', { type: 'button', class: ui.sideCard === id ? 'capsule on' : 'capsule', onclick: () => ((ui.sideCard = id), render()) }, label)),
      h('button', { type: 'button', class: 'capsule', onclick: () => void openRecap() }, t('tab.recapShort')),
    ),
    view(sideDeps),
  );
}

function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

async function openRecap(): Promise<boolean> {
  const r = await guarded(() => api.getRecap(isoWeek(new Date(Date.now() - 7 * 86_400_000))));
  if (!r) return false;
  ui.recap = r;
  ui.tab = 'recap';
  render();
  return true;
}

async function recapGate(): Promise<void> {
  if (!ui.settings || !recapDue(new Date(), ui.settings.recapShownAt ?? null)) return;
  if (!(await openRecap())) return;
  fsm.open();
  await saveSettings({ ...ui.settings, recapShownAt: Date.now() });
}

const dropHooks: DropHooks = {
  ask: (d) => {
    api.attach(d.upload);
    ui.tab = 'chat';
    render();
  },
  chosen: (d) => {
    ui.dropped = d;
    ui.tab = 'choose';
    render();
  },
  flash,
  render: () => render(),
};

function beginUpload(path: string): void {
  fsm.open();
  ui.tab = 'upload';
  ui.upload = startUpload(path, {
    sound: (n) => play(n),
    render: () => render(),
    done: (run) => run.upload && dropHooks.chosen({ path: run.path, upload: run.upload }),
  });
  render();
}

/** A file dropped on a sendable session row is pasted there via `say()`; anywhere else it is uploaded. */
async function onDrop(path: string, x: number, y: number): Promise<void> {
  const id = ui.tab === 'sessions' ? dropTarget(document.elementFromPoint(x / devicePixelRatio, y / devicePixelRatio)) : null;
  const a = id ? agentOf(id) : undefined;
  if (a) {
    await guarded(() => dropIntoSession(a, path), t('common.sentTo', { name: a.codename ?? a.name }));
    return;
  }
  beginUpload(path);
}

function attachmentChips(): Node | null {
  const list = api.attachments();
  if (!list.length) return null;
  return h(
    'div',
    { class: 'chip-row attach-row' },
    ...list.map((u) => h('button', { type: 'button', class: 'chip', title: t('common.remove'), onclick: () => (api.detach(u.uploadId), render()) }, icon(Paperclip, 10), u.name)),
  );
}

function timerHandlers() {
  const set = (t: TimerState) => {
    ui.timer = t;
    saveTimer(t);
    render();
  };
  return { start: () => set(startTimer(ui.timer, Date.now())), pause: () => set(pauseTimer(ui.timer, Date.now())), reset: () => set(resetTimer()) };
}

function onTick(): void {
  const t = tickTimer(ui.timer, Date.now());
  if (t.finished) {
    ui.timer = t.state;
    saveTimer(t.state);
    play('timer');
    fsm.reveal();
  }
  render();
}

let outfit: Outfit = 'none';
let overlay: HTMLElement | null = null;

function wearOutfit(): void {
  const p = outfitPrefs(ui.settings);
  const next = resolveOutfit(p.choice, new Date(), p.hemisphere);
  if (next === outfit && (overlay?.isConnected ?? next === 'none')) return;
  outfit = next;
  overlay?.remove();
  overlay = outfitOverlay(next, 'main', ui.reduced);
  if (overlay) bigMascot.el.append(overlay);
}

function wardrobeTab(): HTMLElement {
  const p = outfitPrefs(ui.settings);
  const s = ui.settings;
  return wardrobeView(p.choice, p.hemisphere, new Date(), {
    pick: (c) => s && void saveSettings({ ...s, outfit: c }),
    hemisphere: (x) => s && void saveSettings({ ...s, hemisphere: x }),
  });
}

async function setCapture(on: boolean): Promise<void> {
  if (!ui.settings) return;
  if ((await guarded(() => api.setCaptureShortcuts(on))) === undefined && on) return;
  await saveSettings({ ...ui.settings, captureShortcuts: on });
}

async function toggleSound(): Promise<void> {
  if (ui.settings) await saveSettings({ ...ui.settings, sounds: !ui.settings.sounds });
}

function content(): HTMLElement {
  if (ui.offline && ui.tab === 'home') return h('div', { class: 'panel' }, h('p', { class: 'warn' }, ui.offline));
  if (ui.tab === 'home' && ui.approvals[0]) return approvalCard(ui.approvals[0], 0, ui.approvals.length, agentOf(ui.approvals[0].agentId), kit, dropApproval);
  if (ui.tab === 'home') {
    return overview({
      slots: ui.slots,
      focused: focusedPill(),
      steps,
      animate: fx().bob,
      pose,
      badge,
      icon: smallIcon,
      onPick: (key) => {
        ui.focusKey = key;
        play('blip');
        render();
      },
      onJump: (a) => void guarded(() => api.focus(a.id)),
      onToggle: render,
    });
  }
  const agents = ui.state?.agents ?? [];
  if (ui.tab === 'chat') {
    const chat = chatView(ui.clis, ui.replies, kit, (m) => m === 'happy' && bigMascot.jump());
    const chips = attachmentChips();
    return chips ? h('div', { class: 'chat-wrap' }, chips, chat) : chat;
  }
  if (ui.tab === 'drop') return dropView(dropHooks);
  if (ui.tab === 'upload') return ui.upload ? uploadView(ui.upload) : dropView(dropHooks);
  if (ui.tab === 'choose') return ui.dropped ? chooseView(ui.dropped, agents, dropHooks) : dropView(dropHooks);
  if (ui.tab === 'side') return sideView();
  if (ui.tab === 'music') return musicView(ui.state?.music, (a) => void guarded(() => api.sideAction('music', a)).then(() => poll()));
  if (ui.tab === 'timer') return timerView(ui.timer, Date.now(), timerHandlers());
  if (ui.tab === 'wardrobe') return wardrobeTab();
  if (ui.tab === 'listening') return listeningView(ui.transcript, stopVoice);
  if (ui.tab === 'recap' && ui.recap) {
    return recapCard(ui.recap, {
      exported: (path) => flash(t('status.saved', { path })),
      failed: (e) => flash(api.errorText(e)),
      close: () => ((ui.tab = 'home'), render()),
    });
  }
  if (ui.tab === 'whatsnew') {
    return whatsNewView(ui.about.version, ui.whatsNew.notes, ui.whatsNew.stats, ui.whatsNew.page, {
      page: (p) => ((ui.whatsNew.page = p), render()),
      close: () => ((ui.tab = 'home'), render()),
    });
  }
  if (ui.tab === 'guide') return guideView(ui.guidePage, { page: (n) => ((ui.guidePage = n), render()), close: closeGuide });
  if (ui.tab === 'sessions') return sessionsView(agents, kit, { approvals: ui.approvals, replies: ui.replies });
  if (ui.tab === 'mains') return mainsView({ agents, replies: ui.replies, approvals: ui.approvals }, kit, dropApproval);
  if (ui.tab === 'launch') return launchView(ui.clis, ui.settings?.recents ?? [], kit, (dir) => void guarded(() => api.addRecent(dir)).then((s) => s && saveLocal(s)));
  return settingsView(
    ui.settings,
    {
      reduced: ui.reduced,
      about: ui.about,
      showGuide,
      side: {
        providers: ui.side.providers,
        settings: ui.side.settings,
        save: (patch) => void saveSide(patch),
        open: (t) => ((ui.tab = t), render()),
        captureShortcuts: (on) => void setCapture(on),
      },
    },
    kit,
    saveSettings,
  );
}

function compactRow(): Node[] {
  const grid = h('div', { class: 'mini-grid' }, ...ui.slots.pills.slice(0, 4).map((p) => miniMascot(pose(p.shown), p.shown.colour, p.urgency === 'active' ? null : badge(p.urgency === 'waiting' ? 'waiting' : p.urgency === 'error' ? 'error' : 'done'), 10)));
  const pill = (el: HTMLElement, to: Tab) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      ui.tab = to;
      fsm.open();
      render();
    });
    return el;
  };
  const music = ui.state?.music;
  const pills = h(
    'div',
    { class: 'compact-pills' },
    running(ui.timer) && pill(timerPill(ui.timer, Date.now()), 'timer'),
    music?.playing && pill(musicPill(music), 'music'),
  );
  return [smallMascot.el, pills, grid];
}

let lastKey = '';
let card: HTMLElement | null = null;
let body: HTMLElement | null = null;

function render(): void {
  const focused = focusedPill();
  const r = ui.tab === 'home' && ui.approvals[0] ? 'waiting' : reactionOf(focused?.shown ?? null);
  const working = r === 'working' || r === 'thinking';
  const now = Date.now();
  const chatP = ui.tab === 'chat' ? chatPose(chatMood()) : null;
  const sideP =
    (fsm.listening && (LISTENING_POSE as MascotPose)) ||
    (ui.tab === 'whatsnew' && (whatsNewPose as MascotPose)) ||
    (ui.tab === 'upload' && (UPLOAD_POSE as MascotPose)) ||
    (r === 'sleeping' || r === 'done' ? (timerPose(ui.timer) as MascotPose | null) ?? musicPose(ui.state?.music, now, ui.reduced) : null);
  bigMascot.set(chatP ?? sideP ?? poseOf(r), working || chatP === 'thinking');
  smallMascot.set(poseOf(r), working);
  wearOutfit();
  if (fsm.mode === 'home' && sizeOf('home').h !== target.h) morph('home');
  root.dataset.mode = fsm.mode;
  document.documentElement.classList.toggle('reduced', ui.reduced);

  const key = JSON.stringify([fsm.mode, ui.tab, ui.sideCard, ui.side, ui.timer, running(ui.timer) ? Math.ceil(now / 1000) : 0, ui.state?.music, ui.upload && [ui.upload.error, ui.upload.done, Math.floor((performance.now() - ui.upload.startedAt) / 100)], ui.dropped?.upload.uploadId, ui.recap?.week, ui.whatsNew.page, ui.whatsNew.stats ? 1 : 0, ui.guidePage, ui.transcript, fsm.listening, api.attachments().length, ui.state?.ts, ui.slots.pills.map((p) => [p.key, p.shown.id, p.urgency]), ui.focusKey, ui.approvals.map((a) => a.id), ui.replies.length, chatMood(), ui.notice, ui.offline, ui.usage, ui.clis.length, ui.settings, cards.rev, r]);
  if (key === lastKey) return;
  lastKey = key;

  compactEl.replaceChildren(...compactRow());
  const active = document.activeElement as HTMLElement | null;
  if (active && homeEl.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'SELECT')) return;

  if (!card) {
    card = h('div', { class: 'card' }, h('div', { class: 'mascot-slot' }, bigMascot.el));
    body = h('div', { class: 'content' });
    card.append(body);
    homeEl.replaceChildren(header(), card);
  }
  homeEl.firstElementChild!.replaceWith(header());
  card.style.setProperty('--wash', WASH[r]);
  card.classList.toggle('with-mascot', MASCOT_TABS.has(ui.tab));
  cards.prune([...chatCardIds(), ...ui.approvals.map((a) => `approval:${a.id}`), ...ui.slots.pills.map((p) => `agent:${p.key}`)]);
  homeEl.classList.toggle('collapsed', collapsed());
  const view = content();
  body!.replaceChildren(view, ...(ui.notice ? [h('p', { class: 'notice' }, ui.notice)] : []));
  fitH = view.classList.contains('approval') || ui.tab === 'sessions' || ui.tab === 'mains' ? view.offsetHeight : null;
  if (fsm.mode === 'home' && sizeOf('home').h !== target.h) morph('home');
}


async function poll(): Promise<void> {
  try {
    const state = await api.getState();
    const before = new Set(ui.approvals.map((a) => a.id));
    const prevUrgency = new Map(ui.slots.pills.map((p) => [p.shown.id, p.urgency]));
    const prevMusic = ui.state?.music;
    ui.state = state;
    ui.offline = '';
    const now = Date.now();
    ui.groups = board.update(state.agents, now);
    ui.slots = sessions.update(state.agents, now);
    steps.track(state.agents);
    ui.approvals = approvalQueue(state.approvals);
    ui.replies = mergeReplies(ui.replies, state.replies);
    const fresh = ui.approvals.filter((a) => !before.has(a.id));
    const moments = ui.groups.flatMap((g) => g.pills.map((p) => p.moment));
    const failed = ui.slots.pills.some((p) => p.urgency === 'error' && prevUrgency.get(p.shown.id) !== 'error');
    if (fresh.length) {
      play(approvalKind(fresh[0]) === 'question' ? 'question' : 'approval');
      ui.tab = 'home';
      bigMascot.pop();
      smallMascot.pop();
      fsm.alert();
    } else if (moments.includes('needs-you')) {
      play('question');
      fsm.alert();
    } else if (moments.includes('finished')) {
      play('finish');
      bigMascot.jump();
      smallMascot.jump();
      fsm.finished();
    } else if (failed) {
      play('error');
      fsm.reveal();
    } else if (musicReveal(prevMusic, state.music)) fsm.reveal();
    else if (state.agents.some((a) => a.state === 'working')) fsm.activity();
  } catch (e) {
    ui.offline = api.errorText(e);
  }
  render();
}

async function slowPoll(): Promise<void> {
  ui.usage = (await api.getUsage().catch(() => null)) ?? ui.usage;
  ui.clis = (await api.getClis().catch(() => null)) ?? ui.clis;
  await loadSide();
  await recapGate();
  render();
}

async function start(): Promise<void> {
  ui.settings = await api.getSettings().catch(() => null);
  applySettings(ui.settings);
  void api.setCaptureShortcuts(ui.settings?.captureShortcuts ?? false).catch((e) => flash(api.errorText(e)));
  ui.reduced = (await api.reduceMotion().catch(() => false)) || prefersReducedMotion();
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', async (e) => {
    ui.reduced = e.matches || (await api.reduceMotion().catch(() => false));
    render();
  });
  ui.about = { name: await getName().catch(() => ui.about.name), version: await getVersion().catch(() => '') };
  ui.emoji = await fetch('emoji/index.json')
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));

  applyShape(shape);
  pushRect(shape);
  layers(fsm.mode, { ...fx(), contentInMs: 0, contentInDelayMs: 0 });
  compactEl.addEventListener('click', () => fsm.click());
  shapeEl.addEventListener('click', () => fsm.mode !== 'home' && fsm.click());
  window.addEventListener('keydown', (e) => e.key === 'Escape' && fsm.esc());
  await listen<{ Ok?: UploadResponse | null; Err?: ApiError }>('capture', (e) => {
    if (e.payload.Err) return flash(api.errorText(e.payload.Err));
    if (!e.payload.Ok) return;
    api.attach(e.payload.Ok);
    ui.tab = 'chat';
    fsm.open();
    flash(t('status.attached', { name: e.payload.Ok.name }));
  });
  await getCurrentWebview().onDragDropEvent((e) => {
    if (e.payload.type === 'over' && fsm.mode !== 'home') fsm.open();
    if (e.payload.type === 'drop' && e.payload.paths[0]) void onDrop(e.payload.paths[0], e.payload.position.x, e.payload.position.y);
  });
  const mascotMenu = (e: Event) => {
    e.preventDefault();
    ui.tab = 'wardrobe';
    fsm.open();
    render();
  };
  bigMascot.el.addEventListener('contextmenu', mascotMenu);
  smallMascot.el.addEventListener('contextmenu', mascotMenu);
  await listen('open-chat', () => {
    ui.tab = 'chat';
    fsm.open();
    render();
    focusChatInput();
  });
  await listen<boolean>('island-hover', (e) => {
    if (e.payload && fsm.mode === 'hidden') play('peek');
    fsm.hover(e.payload);
  });
  if (ui.settings && guideDue(ui.settings.guideSeen)) showGuide();
  render();
  await poll();
  await slowPoll();
  window.setInterval(poll, POLL_MS);
  window.setInterval(slowPoll, 30_000);
  window.setInterval(onTick, TICK_MS);
  scheduleWhatsNew({
    version: ui.about.version,
    lastSeen: ui.settings?.whatsNewSeen ?? null,
    idle: () => fsm.mode !== 'home' && !ui.approvals.length && !fsm.listening,
    show: () => void showWhatsNew(),
    remember: (v) => ui.settings && ui.settings.whatsNewSeen !== v && void saveSettings({ ...ui.settings, whatsNewSeen: v }),
    set: (fn, ms) => window.setTimeout(fn, ms),
  });
}

function showGuide(): void {
  ui.guidePage = 0;
  ui.tab = 'guide';
  fsm.open();
  render();
}

function closeGuide(): void {
  ui.tab = 'home';
  if (ui.settings && !ui.settings.guideSeen) void saveSettings({ ...ui.settings, guideSeen: true });
  else render();
}

async function showWhatsNew(): Promise<void> {
  const notes = await fetch('whats-new.json')
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const list = notes?.[ui.about.version];
  if (Array.isArray(list) && list.every((x) => typeof x === 'string')) ui.whatsNew.notes = list;
  ui.whatsNew.page = 1;
  ui.tab = 'whatsnew';
  play('proud');
  fsm.open();
  render();
  ui.whatsNew.stats = await api.getRecap('all').catch(() => null);
  render();
}

void start();
