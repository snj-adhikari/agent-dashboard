import { invoke } from '@tauri-apps/api/core';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { Camera, FolderSearch, MessageCircle } from 'lucide';
import './side-a.css';
import * as api from '../api';
import { compareAgents } from '../board';
import type { Agent, UploadResponse } from '../types';
import { UPLOAD_VIEW_H } from '../uploadTimeline';
import { h, icon } from './cards';
import { t } from '../i18n';

/** A dropped file (path known) or a captured region (inbox upload only). */
export interface Dropped { path: string | null; upload: UploadResponse }

export interface DropHooks {
  ask(d: Dropped): void;
  chosen(d: Dropped): void;
  flash(text: string): void;
  render(): void;
}

export const sessionTargets = (agents: Agent[]): Agent[] => agents.filter((a) => a.canSend).sort(compareAgents);

/** Path as pasted into a terminal, single-quoted when a shell would split or expand it; null (refused) unless absolute and free of control characters, which would be typed as keys. */
export function pastePath(path: string): string | null {
  if (!path.startsWith('/') || /[\x00-\x1f\x7f]/.test(path)) return null;
  return /^[\w@%+=:,./-]+$/.test(path) ? path : `'${path.replaceAll("'", `'\\''`)}'`;
}

/** Pastes the file path into the agent's terminal through `say()` (main: true); rejects a refused path. */
export function dropIntoSession(a: Agent, path: string): ReturnType<typeof api.say> {
  const text = pastePath(path);
  return text ? api.say(a.id, text) : Promise.reject(new Error(t('drop.absoluteOnly')));
}

const sized = (el: HTMLElement): HTMLElement => {
  el.style.height = `${UPLOAD_VIEW_H}px`;
  return el;
};

/** Drop tab: drop hint plus a region capture that goes straight to the choose view. */
export function dropView(hooks: DropHooks): HTMLElement {
  const capture = async () => {
    try {
      const upload = await invoke<UploadResponse | null>('capture_region');
      if (upload) hooks.chosen({ path: null, upload });
    } catch (e) {
      hooks.flash(api.errorText(e));
    }
  };
  return sized(
    h(
      'div',
      { class: 'drop-view' },
      h('div', { class: 'drop-zone' }, h('span', { class: 'side-name' }, t('drop.here')), h('span', { class: 'side-sub' }, t('drop.captureHint'))),
      h('button', { type: 'button', onclick: () => void capture() }, icon(Camera, 12), t('common.capture')),
    ),
  );
}

/** Choose view after an upload: ask about it, paste it into a session, or reveal it. */
export function chooseView(d: Dropped, agents: Agent[], hooks: DropHooks): HTMLElement {
  const path = d.path;
  const targets = path && pastePath(path) ? sessionTargets(agents) : [];
  const into = (a: Agent) => async () => {
    if (!path) return;
    try {
      await dropIntoSession(a, path);
      hooks.flash(t('common.sentTo', { name: a.codename ?? a.name }));
    } catch (e) {
      hooks.flash(api.errorText(e));
    }
  };
  const reveal = async () => {
    if (!path) return;
    try {
      await revealItemInDir(path);
    } catch (e) {
      hooks.flash(api.errorText(e));
    }
  };
  return sized(
    h(
      'div',
      { class: 'choose-view' },
      h('div', { class: 'choose-file' }, h('span', { class: 'side-name' }, d.upload.name), h('span', { class: 'side-sub' }, d.upload.mime)),
      h(
        'div',
        { class: 'side-actions' },
        h('button', { class: 'primary', type: 'button', onclick: () => hooks.ask(d) }, icon(MessageCircle, 12), t('upload.ask')),
        h('button', { type: 'button', disabled: !path, onclick: () => void reveal() }, icon(FolderSearch, 12), t('upload.reveal')),
      ),
      targets.length > 0 && h('h4', {}, t('upload.intoSession')),
      targets.length > 0 &&
        h('div', { class: 'choose-targets' }, ...targets.map((a) => h('button', { class: 'chip', type: 'button', title: a.cwd, onclick: into(a) }, a.codename ?? a.name))),
    ),
  );
}
