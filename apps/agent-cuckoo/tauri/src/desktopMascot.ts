import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow, PhysicalPosition } from '@tauri-apps/api/window';
import { DesktopMascotLogic, FLY_MS, SIZE, type Place } from './desktopMascotLogic';
import { prefersReducedMotion } from './motion';
import { resolveOutfit, wearsOutfit, type Outfit } from './outfit';
import type { CuckooState } from './types';
import { poseSrc, type MascotPose } from './views/mascot';
import { outfitOverlay, outfitPrefs } from './views/wardrobe';
import './views/side-b.css';
import { t } from './i18n';

const POLL_MS = 2_000;
const DRAG_PX = 4;

/** Pose for the floating mascot from the logic state. */
export function desktopPose(l: Pick<DesktopMascotLogic, 'dizzy' | 'surprised'>, place: Place, asleep: boolean): MascotPose {
  if (l.dizzy) return 'dizzy';
  if (l.surprised) return 'surprised';
  if (place === 'island') return 'waiting';
  return asleep ? 'sleepy' : 'idle';
}

/** Top-centre of the screen in physical pixels, where the island sits. */
export const islandSpot = (screenW: number, dpr: number): { x: number; y: number } => ({ x: Math.round(((screenW - SIZE) / 2) * dpr), y: 0 });

export const outfitShown = (): boolean => wearsOutfit('desktop');

/** Outfit the desktop mascot wears now, from the same wardrobe choice and seasons as the island. */
export function desktopOutfit(settings: unknown, now: Date): Outfit {
  const p = outfitPrefs(settings);
  return resolveOutfit(p.choice, now, p.hemisphere);
}

function boot(): void {
  document.title = t('mascot.title');
  const win = getCurrentWindow();
  const logic = new DesktopMascotLogic(() => Date.now());
  const root = document.getElementById('dm') as HTMLElement;
  const body = document.createElement('div');
  body.className = 'dm-body';
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  body.append(img);
  root.append(body);
  let outfit: Outfit = 'none';
  let overlay: HTMLElement | null = null;
  const wear = (next: Outfit) => {
    if (next === outfit) return;
    outfit = next;
    overlay?.remove();
    overlay = outfitOverlay(next, 'desktop', prefersReducedMotion());
    if (overlay) body.append(overlay);
  };

  let pose: MascotPose | null = null;
  let place: Place = 'desktop';
  let home: PhysicalPosition | null = null;
  let pointer = Infinity;
  let flying = 0;

  const setPose = (p: MascotPose) => {
    if (p === pose) return;
    pose = p;
    img.src = poseSrc(p);
  };

  const fly = async (to: PhysicalPosition) => {
    const id = ++flying;
    const from = await win.outerPosition();
    if (prefersReducedMotion()) return void win.setPosition(to);
    const t0 = performance.now();
    const step = (t: number) => {
      if (id !== flying) return;
      const k = Math.min(1, (t - t0) / FLY_MS);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      void win.setPosition(new PhysicalPosition(Math.round(from.x + (to.x - from.x) * e), Math.round(from.y + (to.y - from.y) * e)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const flyHome = () => {
    if (home) void fly(home);
  };

  const frame = () => {
    const next = logic.place();
    if (next !== place) {
      if (next === 'island') {
        void win.outerPosition().then((p) => {
          home = p;
          const s = islandSpot(screen.width, devicePixelRatio);
          void fly(new PhysicalPosition(s.x, s.y));
        });
      } else flyHome();
      place = next;
    }
    setPose(desktopPose(logic, place, logic.asleep(pointer)));
    window.setTimeout(frame, 1000 / logic.fps(pointer));
  };

  const poll = async () => {
    try {
      const s = await invoke<CuckooState>('cuckoo_get', { what: 'state' });
      logic.alerts(s.approvals.length > 0);
    } catch {
      logic.alerts(false);
    }
    try {
      wear(desktopOutfit(await invoke('get_settings'), new Date()));
    } catch {}
    window.setTimeout(poll, POLL_MS);
  };

  let down: { x: number; y: number } | null = null;
  root.addEventListener('mousedown', (e) => {
    down = { x: e.screenX, y: e.screenY };
    logic.activity();
  });
  root.addEventListener('mousemove', (e) => {
    pointer = Math.hypot(e.offsetX - SIZE / 2, e.offsetY - SIZE / 2);
    logic.activity();
    if (down && e.buttons === 1 && Math.hypot(e.screenX - down.x, e.screenY - down.y) > DRAG_PX) {
      down = null;
      flying++;
      void win.startDragging();
    }
  });
  root.addEventListener('mouseleave', () => {
    pointer = Infinity;
  });
  root.addEventListener('click', (e) => {
    down = null;
    if (e.detail !== 1) return;
    const r = logic.poke();
    if (r === 'ignored') return;
    root.classList.remove('poke');
    void root.offsetWidth;
    root.classList.add('poke');
  });
  root.addEventListener('dblclick', () => {
    logic.activity();
    flyHome();
  });

  setPose('idle');
  frame();
  void poll();
}

if (typeof document !== 'undefined' && document.getElementById('dm')) boot();
