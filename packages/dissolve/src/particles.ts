import { noise3, onFrame, pixelRatio } from '@elementalfx/core';

/**
 * Dust specks and sparks, drawn on one page-wide canvas shared by every
 * running dissolve. Positions are in document px, so specks stay put while
 * the page scrolls. The canvas exists only while something is flying.
 */
export interface Speck {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds lived and seconds to live. */
  age: number;
  life: number;
  size: number;
  color: string;
  kind: 'dust' | 'spark' | 'gather';
  /** For 'gather': fly from (x0, y0) to (x1, y1), arriving at the end of life. */
  x0?: number;
  y0?: number;
  x1?: number;
  y1?: number;
  /** Seconds to wait before showing up. */
  delay?: number;
}

const MAX_SPECKS = 12000;
let specks: Speck[] = [];
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let stop: (() => void) | null = null;
let ratio = 1;
let time = 0;

function ensureCanvas(): CanvasRenderingContext2D {
  if (ctx && canvas?.isConnected) return ctx;
  canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('data-fx', 'dissolve');
  canvas.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483000';
  document.body.append(canvas);
  ctx = canvas.getContext('2d')!;
  resize();
  return ctx;
}

function resize(): void {
  if (!canvas) return;
  ratio = pixelRatio(2);
  const width = document.documentElement.clientWidth;
  const height = document.documentElement.clientHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
}

export function emit(batch: Speck[]): void {
  if (batch.length === 0 || typeof document === 'undefined') return;
  const room = MAX_SPECKS - specks.length;
  if (room <= 0) return;
  specks.push(...(batch.length > room ? batch.slice(0, room) : batch));
  ensureCanvas();
  if (!stop) {
    window.addEventListener('resize', resize);
    stop = onFrame(frame);
  }
}

/** How many specks are flying. Useful in tests. */
export function activeSpecks(): number {
  return specks.length;
}

function frame(dt: number): void {
  time += dt;
  const context = ensureCanvas();
  const width = canvas!.width;
  const height = canvas!.height;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  context.setTransform(ratio, 0, 0, ratio, -window.scrollX * ratio, -window.scrollY * ratio);

  const alive: Speck[] = [];
  const sparks: Speck[] = [];
  for (const s of specks) {
    if (s.delay && s.delay > 0) {
      s.delay -= dt;
      alive.push(s);
      continue;
    }
    s.age += dt;
    if (s.age >= s.life) continue;
    alive.push(s);
    const k = s.age / s.life;
    let alpha: number;
    let size = s.size;
    if (s.kind === 'gather') {
      // Ease in toward the target, fading in on the way.
      const e = 1 - Math.pow(1 - k, 3);
      s.x = s.x0! + (s.x1! - s.x0!) * e;
      s.y = s.y0! + (s.y1! - s.y0!) * e + Math.sin(k * Math.PI) * -18;
      alpha = Math.min(1, k * 3);
    } else {
      // Drift on a slowly turning breeze.
      const swirl = noise3(s.x * 0.01, s.y * 0.01, time * 0.6) * 140;
      s.vx += swirl * dt;
      s.vy += (s.kind === 'spark' ? -220 : -40) * dt;
      const drag = Math.exp(-(s.kind === 'spark' ? 1.2 : 0.6) * dt);
      s.vx *= drag;
      s.vy *= drag;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      alpha = 1 - k * k;
      size *= s.kind === 'spark' ? 1 - k * 0.7 : 1 - k * 0.5;
    }
    if (s.kind === 'spark') {
      sparks.push(s);
      continue;
    }
    context.globalAlpha = alpha;
    context.fillStyle = s.color;
    context.fillRect(s.x - size / 2, s.y - size / 2, size, size);
  }
  if (sparks.length) {
    // Sparks glow where they overlap.
    context.globalCompositeOperation = 'lighter';
    for (const s of sparks) {
      const k = s.age / s.life;
      const size = s.size * (1 - k * 0.7);
      context.fillStyle = s.color;
      context.globalAlpha = (1 - k) * 0.25;
      context.fillRect(s.x - size * 1.5, s.y - size * 1.5, size * 3, size * 3);
      context.globalAlpha = 1 - k;
      context.fillRect(s.x - size / 2, s.y - size / 2, size, size);
    }
    context.globalCompositeOperation = 'source-over';
  }
  context.globalAlpha = 1;
  specks = alive;

  if (specks.length === 0) {
    stop?.();
    stop = null;
    window.removeEventListener('resize', resize);
    canvas?.remove();
    canvas = null;
    ctx = null;
  }
}
