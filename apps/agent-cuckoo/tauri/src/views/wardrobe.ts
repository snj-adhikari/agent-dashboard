import { OUTFIT_TWEEN_MS, OUTFITS, outfitLayer, resolveOutfit, wearsOutfit, type Hemisphere, type MascotKind, type Outfit, type OutfitChoice } from '../outfit';
import { h } from './cards';
import { poseSrc } from './mascot';
import './side-b.css';
import { t } from '../i18n';

export const DEFAULT_HEMISPHERE: Hemisphere = 'south';

export const outfitLabel = (c: OutfitChoice): string => (c === 'auto' ? t('common.auto') : t(`outfit.${c}`));

export interface WardrobeOption { choice: OutfitChoice; label: string; selected: boolean; wearing: Outfit }

export function wardrobeOptions(choice: OutfitChoice, date: Date, hemisphere: Hemisphere = DEFAULT_HEMISPHERE): WardrobeOption[] {
  return (['auto', ...OUTFITS] as OutfitChoice[]).map((c) => ({ choice: c, label: outfitLabel(c), selected: c === choice, wearing: resolveOutfit(c, date, hemisphere) }));
}

/** Reads the wardrobe choice from settings; unknown or missing values fall back to Auto and the southern hemisphere. */
export function outfitPrefs(raw: unknown): { choice: OutfitChoice; hemisphere: Hemisphere } {
  const v = (raw ?? {}) as { outfit?: unknown; hemisphere?: unknown };
  const choice = v.outfit === 'auto' || (OUTFITS as readonly unknown[]).includes(v.outfit) ? (v.outfit as OutfitChoice) : 'auto';
  return { choice, hemisphere: v.hemisphere === 'north' ? 'north' : DEFAULT_HEMISPHERE };
}

/** Outfit layer for a mascot. Fades in over 350 ms unless motion is reduced. */
export function outfitOverlay(outfit: Outfit, kind: MascotKind, reduced: boolean): HTMLElement | null {
  const layer = wearsOutfit(kind) ? outfitLayer(outfit) : null;
  if (!layer) return null;
  const img = h('img', { class: 'outfit', src: layer.src, srcset: layer.srcset, alt: '', draggable: 'false' }) as HTMLImageElement;
  if (!reduced && typeof img.animate === 'function') img.animate([{ opacity: 0, transform: 'scale(0.9)' }, { opacity: 1, transform: 'scale(1)' }], { duration: OUTFIT_TWEEN_MS, easing: 'ease-out' });
  return img;
}

/** Idle cuckoo with the outfit layered on top, sized by CSS. */
export function dressedMascot(outfit: Outfit, cls: string): HTMLElement {
  const layer = outfitLayer(outfit);
  return h(
    'span',
    { class: `dressed ${cls}` },
    h('img', { src: poseSrc('idle'), srcset: `${poseSrc('idle')} 1x, mascot/cuckoo-idle@2x.png 2x`, alt: '', draggable: 'false' }),
    layer && h('img', { class: 'outfit', src: layer.src, srcset: layer.srcset, alt: '', draggable: 'false' }),
  );
}

export function wardrobeView(choice: OutfitChoice, hemisphere: Hemisphere, now: Date, on: { pick(c: OutfitChoice): void; hemisphere(h: Hemisphere): void }): HTMLElement {
  const opts = wardrobeOptions(choice, now, hemisphere);
  const current = opts.find((o) => o.selected) ?? opts[0];
  return h(
    'div',
    { class: 'panel wardrobe' },
    h(
      'div',
      { class: 'wardrobe-side' },
      dressedMascot(current.wearing, 'wardrobe-preview'),
      h('span', { class: 'wardrobe-current' }, current.label),
      h(
        'div',
        { class: 'srow-set' },
        h('span', {}, t('settings.seasons')),
        ...(['south', 'north'] as Hemisphere[]).map((x) =>
          h('button', { type: 'button', class: x === hemisphere ? 'capsule on' : 'capsule', onclick: () => on.hemisphere(x) }, x === 'south' ? t('settings.southern') : t('settings.northern')),
        ),
      ),
    ),
    h(
      'div',
      { class: 'wardrobe-grid', role: 'radiogroup', 'aria-label': t('settings.outfit') },
      ...opts.map((o) =>
        h(
          'button',
          { type: 'button', role: 'radio', 'aria-checked': String(o.selected), class: o.selected ? 'wardrobe-tile on' : 'wardrobe-tile', title: o.label, onclick: () => on.pick(o.choice) },
          dressedMascot(o.wearing, 'wardrobe-thumb'),
          h('span', {}, o.label),
        ),
      ),
    ),
  );
}
