import { createRandom, isBrowser, onFrame, prefersReducedMotion, resolveElement } from '@elementalfx/core';
import { createFilter, type DissolveFilter } from './filter';
import { createDrip, createMask, type Mask } from './mask';
import { resolveOptions, type DissolveDirection, type DissolveOptions, type ResolvedDissolveOptions } from './options';
import { emit, type Speck } from './particles';
import { snapshot } from './snapshot';

type Target = Element | string;
type Styled = Element & ElementCSSInlineStyle;

/** Elements hidden by a finished dissolve, with the inline visibility they had before. */
const hidden = new WeakMap<Element, [string, string]>();
/** Finishes the animation running on an element, if any. */
const running = new WeakMap<Element, () => void>();
/** The style attribute as written, and as the browser reads it, before we first touched it. */
const originals = new WeakMap<Element, { attribute: string | null; css: string }>();

function remember(element: Styled): void {
  if (!originals.has(element)) originals.set(element, { attribute: element.getAttribute('style'), css: element.style.cssText });
}

/** Once our inline styles are all gone, puts the style attribute back word for word. */
function tidy(element: Styled): void {
  const original = originals.get(element);
  if (!original || element.style.cssText !== original.css) return;
  originals.delete(element);
  // Reading first makes Chrome write out pending style changes, so it can't re-add style="" later.
  element.getAttribute('style');
  if (original.attribute === null) element.removeAttribute('style');
  else element.setAttribute('style', original.attribute);
}

const MELT_REACH = 1.6;
const SPECK_BUDGET = 6000;

/**
 * Makes an element vanish: crumbling into dust, burning away, melting or
 * fading. Resolves when it has gone. The element is then hidden (keeping
 * its space) or removed, depending on `after`.
 */
export function dissolve(target: Target, options: DissolveOptions = {}): Promise<void> {
  return animate(target, options, false);
}

/**
 * The same effects in reverse: dust gathers into the element, a burn
 * un-burns, a melt runs back up. Works on an element hidden by `dissolve`,
 * or on one that is visible (it disappears first, then assembles).
 */
export function assemble(target: Target, options: DissolveOptions = {}): Promise<void> {
  return animate(target, options, true);
}

/** Whether `dissolve` has hidden this element. */
export function isDissolved(target: Target): boolean {
  return isBrowser && hidden.has(resolveElement<Element>(target));
}

function hide(element: Styled): void {
  remember(element);
  if (!hidden.has(element)) {
    hidden.set(element, [element.style.getPropertyValue('visibility'), element.style.getPropertyPriority('visibility')]);
  }
  element.style.setProperty('visibility', 'hidden', 'important');
}

function unhide(element: Styled): void {
  const saved = hidden.get(element);
  if (!saved) return;
  hidden.delete(element);
  if (saved[0]) element.style.setProperty('visibility', saved[0], saved[1]);
  else element.style.removeProperty('visibility');
  tidy(element);
}

function direction(value: DissolveDirection): [number, number] {
  switch (value) {
    case 'right':
      return [1, 0];
    case 'left':
      return [-1, 0];
    case 'up':
      return [0, -1];
    case 'down':
      return [0, 1];
    default:
      return [0, 0];
  }
}

interface Cell {
  /** Centre in element px. */
  x: number;
  y: number;
  /** When it vanishes, in mask units. */
  at: number;
  color: string;
}

function parseColor(value: string): [number, number, number, number] | null {
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const parts = match[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts.length > 3 ? parts[3]! : 1];
}

/** The specks an element breaks into: one per `grain` px where the element has ink. */
async function cells(element: Element, width: number, height: number, mask: Mask, o: ResolvedDissolveOptions): Promise<Cell[]> {
  let grain = o.grain;
  while ((width / grain) * (height / grain) > 60000) grain *= 1.5;
  const columns = Math.max(1, Math.ceil(width / grain));
  const rows = Math.max(1, Math.ceil(height / grain));
  const picture = await snapshot(element, width, height, columns, rows);
  const random = createRandom(o.seed ^ 0x5bd1e995);
  const result: Cell[] = [];

  if (picture) {
    const { data } = picture;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < columns; i++) {
        const k = (j * columns + i) * 4;
        const alpha = data[k + 3]!;
        if (alpha < 40) continue;
        const r = data[k]!;
        const g = data[k + 1]!;
        const b = data[k + 2]!;
        const x = (i + 0.5) * grain;
        const y = (j + 0.5) * grain;
        result.push({ x, y, at: mask.at(x, y), color: `rgb(${r},${g},${b})` });
      }
    }
    return result;
  }

  // No picture: guess from the element's own colors.
  const style = getComputedStyle(element);
  const background = parseColor(style.backgroundColor);
  const ink = parseColor(style.color) ?? [40, 40, 40, 1];
  const solid = background && background[3] > 0.1;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      if (!solid && random() > 0.3) continue;
      const [r, g, b] = solid && random() > 0.15 ? background : ink;
      const x = (i + 0.5) * grain;
      const y = (j + 0.5) * grain;
      result.push({ x, y, at: mask.at(x, y), color: `rgb(${r},${g},${b})` });
    }
  }
  return result;
}

async function animate(target: Target, options: DissolveOptions, reverse: boolean): Promise<void> {
  if (!isBrowser) return;
  const element = resolveElement<Element>(target) as Styled;
  running.get(element)?.();
  const o = resolveOptions(options);

  if (o.duration === 0) {
    // At once, with no frame in between, e.g. to start out hidden.
    if (reverse) unhide(element);
    else finishVanish(element, o);
    return;
  }

  if (o.respectReducedMotion && prefersReducedMotion()) {
    // A plain, quick fade instead of anything that moves.
    if (reverse) unhide(element);
    const fade = element.animate?.([{ opacity: reverse ? 0 : 1 }, { opacity: reverse ? 1 : 0 }], { duration: 250, easing: 'ease' });
    await fade?.finished.catch(() => undefined);
    if (!reverse) finishVanish(element, o);
    return;
  }

  const html = element as unknown as HTMLElement;
  const rect = element.getBoundingClientRect();
  const width = html.offsetWidth || rect.width;
  const height = html.offsetHeight || rect.height;
  if (width < 1 || height < 1) {
    if (reverse) unhide(element);
    else finishVanish(element, o);
    return;
  }

  const melting = o.effect === 'melt';
  const mask = melting ? null : createMask(width, height, o);
  const filter = createFilter({
    effect: o.effect,
    width,
    height,
    mask: mask?.url ?? '',
    drip: melting ? createDrip(width, height, MELT_REACH, o.seed) : undefined,
    reach: MELT_REACH,
    color: o.color,
  });

  // Apply the filter in its starting state before anything else can paint.
  const savedFilter: [string, string] = [element.style.getPropertyValue('filter'), element.style.getPropertyPriority('filter')];
  const computedFilter = getComputedStyle(element).filter;
  const place = (p: number): void => {
    if (melting) {
      const k = reverse ? 1 - p : p;
      filter.melt(height * 1.8 * k * k, 1 - smoothstep(0.5, 1, k));
    } else {
      const k = reverse ? 1 - p : p;
      filter.set(filter.start + (filter.end - filter.start) * k);
    }
  };
  place(0);
  remember(element);
  element.style.setProperty('filter', `url(#${filter.id})${computedFilter && computedFilter !== 'none' ? ` ${computedFilter}` : ''}`, 'important');
  if (reverse) unhide(element);

  // Wait for the mask image so the filter never shows a frame without it.
  await decode(mask?.url);
  const specks = mask && (o.effect === 'dust' || o.effect === 'burn') && o.particles > 0 ? await cells(element, width, height, mask, o) : [];

  return new Promise<void>((resolve) => {
    let elapsed = 0;
    let stop: (() => void) | null = null;
    const random = createRandom(o.seed ^ 0x27d4eb2f);
    const [dx, dy] = direction(o.direction);
    const order = specks.sort((a, b) => a.at - b.at);
    let next = 0;
    const share = order.length ? Math.min(1, (SPECK_BUDGET * o.particles) / order.length) : 0;

    const finish = (): void => {
      if (running.get(element) === finish) running.delete(element);
      stop?.();
      stop = null;
      filter.destroy();
      if (savedFilter[0]) element.style.setProperty('filter', savedFilter[0], savedFilter[1]);
      else element.style.removeProperty('filter');
      tidy(element);
      if (!reverse) finishVanish(element, o);
      resolve();
    };
    running.set(element, finish);

    if (reverse && o.effect === 'dust') gather(element, order, share, o, dx, dy, filter, random);

    stop = onFrame((dt) => {
      elapsed += dt;
      const p = Math.min(1, elapsed / o.duration);
      place(p);
      if (!reverse && order.length) {
        const edge = filter.start + (filter.end - filter.start) * p;
        const box = element.getBoundingClientRect();
        const sx = box.width / width;
        const sy = box.height / height;
        const batch: Speck[] = [];
        while (next < order.length && order[next]!.at <= edge) {
          const cell = order[next++]!;
          const x = box.left + window.scrollX + cell.x * sx;
          const y = box.top + window.scrollY + cell.y * sy;
          if (o.effect === 'burn') burnSpecks(batch, x, y, o, random);
          else if (random() < share) batch.push(dust(cell, x, y, o, dx, dy, width, height, random));
        }
        emit(batch);
      }
      if (p >= 1) finish();
    });
  });
}

function dust(cell: Cell, x: number, y: number, o: ResolvedDissolveOptions, dx: number, dy: number, width: number, height: number, random: () => number): Speck {
  let ux = dx;
  let uy = dy;
  if (ux === 0 && uy === 0) {
    // No direction: blow outward from the middle.
    const ox = cell.x - width / 2;
    const oy = cell.y - height / 2;
    const length = Math.hypot(ox, oy) || 1;
    ux = ox / length;
    uy = oy / length;
  }
  const speed = 50 + random() * 150;
  return {
    x,
    y,
    vx: ux * speed + (random() - 0.5) * 70,
    vy: uy * speed + (random() - 0.5) * 70 - 30 - random() * 60,
    age: 0,
    life: 0.8 + random() * 1.1,
    size: o.grain * (0.7 + random() * 0.6),
    color: cell.color,
    kind: 'dust',
  };
}

const SPARKS = ['#fff3b0', '#ffd166', '#ff9f1c', '#ff6b00'];

function burnSpecks(batch: Speck[], x: number, y: number, o: ResolvedDissolveOptions, random: () => number): void {
  const roll = random();
  if (roll < 0.03 * o.particles) {
    batch.push({
      x,
      y,
      vx: (random() - 0.5) * 90,
      vy: -60 - random() * 160,
      age: 0,
      life: 0.5 + random() * 0.9,
      size: 1.5 + random() * 2,
      color: SPARKS[Math.floor(random() * SPARKS.length)]!,
      kind: 'spark',
    });
  } else if (roll < 0.03 * o.particles + 0.06 * o.particles) {
    // Ash: the element's color, burnt dark.
    batch.push({
      x,
      y,
      vx: (random() - 0.5) * 40,
      vy: -20 - random() * 50,
      age: 0,
      life: 0.6 + random() * 0.8,
      size: o.grain * (0.6 + random() * 0.5),
      color: '#2b211c',
      kind: 'dust',
    });
  }
}

/** Specks that fly in and land on their spot just as it appears. */
function gather(
  element: Element,
  order: Cell[],
  share: number,
  o: ResolvedDissolveOptions,
  dx: number,
  dy: number,
  filter: DissolveFilter,
  random: () => number,
): void {
  const box = element.getBoundingClientRect();
  const html = element as HTMLElement;
  const sx = box.width / (html.offsetWidth || box.width);
  const sy = box.height / (html.offsetHeight || box.height);
  const span = filter.end - filter.start;
  const batch: Speck[] = [];
  for (const cell of order) {
    if (random() >= share) continue;
    // The edge runs backwards, so a spot appears once the edge drops below its value.
    const arrival = ((filter.end - cell.at) / span) * o.duration;
    const flight = Math.min(arrival, 0.6 + random() * 0.6);
    if (flight < 0.05) continue;
    const x1 = box.left + window.scrollX + cell.x * sx;
    const y1 = box.top + window.scrollY + cell.y * sy;
    let ux = dx;
    let uy = dy;
    if (ux === 0 && uy === 0) {
      const angle = random() * Math.PI * 2;
      ux = Math.cos(angle);
      uy = Math.sin(angle);
    }
    const distance = 80 + random() * 180;
    batch.push({
      x: x1,
      y: y1,
      vx: 0,
      vy: 0,
      age: 0,
      life: flight,
      delay: arrival - flight,
      size: o.grain * (0.7 + random() * 0.6),
      color: cell.color,
      kind: 'gather',
      x0: x1 + ux * distance + (random() - 0.5) * 60,
      y0: y1 + uy * distance + (random() - 0.5) * 60 - 30,
      x1,
      y1,
    });
  }
  emit(batch);
}

function finishVanish(element: Styled, o: ResolvedDissolveOptions): void {
  if (o.after === 'remove') element.remove();
  else hide(element);
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function decode(url: string | undefined): Promise<void> {
  if (!url) return Promise.resolve();
  const image = new Image();
  image.src = url;
  return image.decode().catch(() => undefined);
}
