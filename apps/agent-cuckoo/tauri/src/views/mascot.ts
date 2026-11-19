import type { Motion } from '../motion';
import type { Pose } from '../reaction';

export type MascotPose = Pose | 'idle' | 'blink' | 'clock' | 'wave' | 'bird';

const BLINKS: ReadonlySet<MascotPose> = new Set(['idle', 'happy', 'waiting']);
const POP_EASE = 'cubic-bezier(.3,1.2,.4,1)';

export const poseSrc = (pose: MascotPose) => `mascot/cuckoo-${pose}.png`;

function poseImg(pose: MascotPose): HTMLImageElement {
  const img = document.createElement('img');
  img.src = poseSrc(pose);
  img.srcset = `mascot/cuckoo-${pose}.png 1x, mascot/cuckoo-${pose}@2x.png 2x`;
  img.alt = '';
  img.draggable = false;
  return img;
}

/** Persistent mascot: eased pose cross-fade, random blink, bob while working, clock pop and happy jump; all frozen under reduced motion. */
export class Mascot {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private img: HTMLImageElement;
  private pose: MascotPose = 'idle';
  private blinkTimer = 0;

  constructor(size: number, private motion: () => Motion) {
    this.el = document.createElement('div');
    this.el.className = 'mascot';
    this.el.style.setProperty('--size', `${size}px`);
    this.body = document.createElement('div');
    this.body.className = 'mascot-body';
    this.img = poseImg('idle');
    this.body.append(this.img);
    this.el.append(this.body);
    this.scheduleBlink(1_500 + Math.random() * 2_000);
  }

  set(pose: MascotPose, working = false): void {
    this.el.classList.toggle('bob', working && this.motion().bob);
    if (pose === this.pose) return;
    this.pose = pose;
    this.swap(pose);
  }

  pop(): void {
    if (!this.motion().bob) return;
    const target = this.pose;
    this.swap('clock', 0);
    window.setTimeout(() => {
      this.swap(target, 0);
      this.body.animate([{ transform: 'scale(0.6) translateY(20%)' }, { transform: 'scale(1)' }], { duration: 300, easing: POP_EASE });
    }, 300);
  }

  jump(): void {
    if (!this.motion().bob) return;
    this.body.animate(
      [
        { transform: 'translateY(0) scale(1, 1)', offset: 0 },
        { transform: 'translateY(-30%) scale(0.92, 1.18)', offset: 0.25 },
        { transform: 'translateY(3%) scale(1.06, 0.88)', offset: 0.67 },
        { transform: 'translateY(0) scale(1, 1)', offset: 1 },
      ],
      { duration: 480, easing: 'ease-out' },
    );
  }

  private swap(pose: MascotPose, ms = this.motion().bob ? 400 : 200): void {
    const next = poseImg(pose);
    const prev = this.img;
    this.img = next;
    if (ms === 0) {
      prev.replaceWith(next);
      return;
    }
    next.style.opacity = '0';
    this.body.append(next);
    next.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: 'ease-in-out', fill: 'forwards' });
    prev.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'ease-in-out', fill: 'forwards' }).onfinish = () => prev.remove();
  }

  private scheduleBlink(ms: number): void {
    window.clearTimeout(this.blinkTimer);
    this.blinkTimer = window.setTimeout(() => {
      if (this.motion().bob && BLINKS.has(this.pose) && this.el.isConnected) {
        const double = Math.random() < 0.22;
        this.blink(double ? 2 : 1);
      }
      this.scheduleBlink(2_200 + Math.random() * 3_200);
    }, ms);
  }

  private blink(times: number): void {
    const open = this.img;
    const shut = poseImg('blink');
    shut.className = 'blink';
    this.body.append(shut);
    window.setTimeout(() => {
      shut.remove();
      if (times > 1) window.setTimeout(() => open.isConnected && this.blink(times - 1), 120);
    }, 120);
  }
}

/** Small static mascot for pills and the compact grid, tinted ring in the agent colour plus a state badge. */
export function miniMascot(pose: MascotPose, colour: string | null, badge: Node | null, size = 16): HTMLElement {
  const el = document.createElement('span');
  el.className = 'mini';
  el.style.setProperty('--size', `${size}px`);
  if (colour) el.style.setProperty('--tint', colour);
  const img = poseImg(pose);
  el.append(img);
  if (badge) {
    const b = document.createElement('span');
    b.className = 'mini-badge';
    b.append(badge);
    el.append(b);
  }
  return el;
}
