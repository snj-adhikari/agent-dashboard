import { Pause, Play, SkipBack, SkipForward } from 'lucide';
import { danceFrame, type Pose } from '../reaction';
import type { Music } from '../types';
import { h, icon } from './cards';
import './side-b.css';
import { t } from '../i18n';

export type MusicAction = 'play' | 'pause' | 'next' | 'prev';

export const musicLabel = (m: Music): string => (m.artist ? t('music.nowPlaying', { title: m.title, artist: m.artist }) : m.title);

/** Dance pose while playing, null otherwise; frozen on one frame under reduced motion. */
export const musicPose = (m: Music | null | undefined, now: number, reduced: boolean): Pose | null => danceFrame(now, m?.playing ?? false, reduced);

/** True when a new track starts playing: the island reveals the pill without a sound. */
export function musicReveal(prev: Music | null | undefined, next: Music | null | undefined): boolean {
  if (!next?.playing) return false;
  return !prev?.playing || prev.title !== next.title || prev.artist !== next.artist || prev.player !== next.player;
}

export function musicPill(m: Music): HTMLElement {
  return h('span', { class: 'music-pill', title: musicLabel(m) }, h('span', { class: m.playing ? 'eq on' : 'eq' }, h('i'), h('i'), h('i')), h('span', { class: 'music-title' }, musicLabel(m)));
}

export function musicView(m: Music | null | undefined, onAction: (a: MusicAction) => void): HTMLElement {
  if (!m) return h('p', { class: 'muted panel' }, t('music.emptyShort'));
  const btn = (label: string, node: Parameters<typeof icon>[0], a: MusicAction, primary = false) =>
    h('button', { type: 'button', class: primary ? 'round primary' : 'round', 'aria-label': label, onclick: () => onAction(a) }, icon(node));
  return h(
    'div',
    { class: 'panel music' },
    h('div', { class: 'music-meta' }, h('span', { class: 'music-title' }, m.title), m.artist && h('span', { class: 'muted' }, m.artist), h('span', { class: 'tag' }, m.player === 'spotify' ? 'Spotify' : t('tab.music'))),
    h(
      'div',
      { class: 'actions' },
      btn(t('common.previous'), SkipBack, 'prev'),
      m.playing ? btn(t('common.pause'), Pause, 'pause', true) : btn(t('common.play'), Play, 'play', true),
      btn(t('common.next'), SkipForward, 'next'),
    ),
  );
}
