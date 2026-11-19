import { blinkMs } from '../reaction';
import { h } from './cards';
import './side-b.css';
import { t } from '../i18n';

export const LISTENING_POSE = 'listening';

/** Blink gap while listening (3.0-4.5 s); `r` is a random number in [0, 1). */
export const listeningBlinkMs = (r: number): number => blinkMs(r, true);

/** Push-to-talk shows only where the webview exposes speech recognition. */
export function voiceAvailable(g: object = globalThis): boolean {
  return 'SpeechRecognition' in g || 'webkitSpeechRecognition' in g;
}

export function listeningView(transcript: string, onStop: () => void): HTMLElement {
  return h(
    'div',
    { class: 'panel listening', 'aria-live': 'polite' },
    h('span', { class: 'listening-dot' }),
    h('span', { class: transcript ? 'listening-text' : 'listening-text muted' }, transcript || t('listening.titleShort')),
    h('button', { type: 'button', onclick: onStop }, t('common.stop')),
  );
}
