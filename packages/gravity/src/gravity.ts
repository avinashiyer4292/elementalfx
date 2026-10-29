import { EffectRuntime, isBrowser, prefersReducedMotion, resolveElement } from '@elementalfx/core';
import { Body } from './body';
import { resolveOptions, type GravityOptions, type ResolvedGravityOptions } from './options';
import { pickElements, splitText, type SplitResult } from './pick';
import type { Grab } from './grab';
import { World } from './world';

export type GravityState = 'idle' | 'falling' | 'restoring';

export interface Gravity {
  /** The element whose contents fall. */
  readonly element: HTMLElement;
  readonly options: Readonly<ResolvedGravityOptions>;
  /** 'idle' (in place), 'falling' (dropped, including while settled) or 'restoring'. */
  readonly state: GravityState;
  /** How many elements are falling. */
  readonly bodies: number;
  /** Let everything fall. Resolves once it all comes to rest. */
  drop(): Promise<void>;
  /** Fly everything back into place. Resolves when the page is as it was. */
  restore(): Promise<void>;
  /** Drop if in place, restore if dropped. */
  toggle(): Promise<void>;
  /**
   * Blow everything apart from a point in viewport px (like a click's
   * clientX/clientY; the middle of the target by default). Drops first if
   * needed. Resolves once everything rests again.
   */
  explode(at?: { x: number; y: number }, strength?: number): Promise<void>;
  set(options: GravityOptions): void;
  /** Put everything back at once and stop listening. */
  destroy(): void;
}

type Styled = Element & ElementCSSInlineStyle;

interface Item {
  element: Styled;
  body: Body;
  /** Centre in document px when dropped. */
  x0: number;
  y0: number;
  /** Inside position: fixed, so it moves with the viewport, not the document. */
  fixed: boolean;
  /** The element's own transform, kept underneath ours. */
  base: string;
  saved: Map<string, [string, string]>;
  from?: { x: number; y: number; angle: number };
}

const WALL = 1000;

/**
 * Makes the contents of `target` (the whole page by default) fall, tumble and
 * pile up at the bottom of the screen, then fly back into place.
 */
export function createGravity(target: HTMLElement | string = 'body', options: GravityOptions = {}): Gravity {
  let element = isBrowser ? resolveElement(target) : (target as HTMLElement);
  if (isBrowser && element === document.documentElement) element = document.body;
  return new GravityEffect(element, options);
}

class GravityEffect implements Gravity {
  options: ResolvedGravityOptions;
  state: GravityState = 'idle';
  private world: World | null = null;
  private items: Item[] = [];
  private walls: Body[] = [];
  private split: SplitResult | null = null;
  private runtime: EffectRuntime | null = null;
  private scrollX = 0;
  private scrollY = 0;
  private restoreTime = 0;
  private settleWaiters: (() => void)[] = [];
  private restoreWaiters: (() => void)[] = [];
  private cleanups: (() => void)[] = [];
  private destroyed = false;
  private byElement = new WeakMap<Element, Item>();
  private drag: { grab: Grab; pointer: number; x: number; y: number; moved: boolean } | null = null;

  constructor(
    readonly element: HTMLElement,
    options: GravityOptions,
  ) {
    this.options = resolveOptions(options);
    if (!isBrowser) return;
    this.runtime = new EffectRuntime({
      element: this.element,
      frame: (dt) => this.frame(dt),
      pauseOffscreen: false,
      respectReducedMotion: this.options.respectReducedMotion,
      onReducedMotionChange: (reduce) => {
        if (reduce) this.reset();
      },
    });
    this.runtime.sleep();
    this.listen(window, 'resize', () => this.fitWalls());
    // Elements inside position: fixed move with the viewport, so keep them in step.
    this.listen(window, 'scroll', () => this.renderFixed(), { passive: true });
    this.listen(this.element, 'pointerdown', (event: PointerEvent) => this.grabAt(event));
    this.listen(window, 'pointermove', (event: PointerEvent) => this.dragTo(event));
    this.listen(window, 'pointerup', (event: PointerEvent) => this.letGo(event));
    this.listen(window, 'pointercancel', (event: PointerEvent) => this.letGo(event));
    // No native image or link dragging, and no text selection, while things are loose.
    this.listen(this.element, 'dragstart', (event: Event) => {
      if (this.state !== 'idle') event.preventDefault();
    });
    this.listen(window, 'keydown', (event: KeyboardEvent) => {
      if (event.key === 'Escape' && this.options.restoreOnEscape && this.state !== 'idle') void this.restore();
    });
    this.armTrigger();
  }

  get bodies(): number {
    return this.items.length;
  }

  drop(): Promise<void> {
    if (!isBrowser || this.destroyed || this.reduced()) return Promise.resolve();
    if (this.state === 'restoring') this.resumeFromRestore();
    else if (this.state === 'idle') this.start();
    const settled = new Promise<void>((resolve) => this.settleWaiters.push(resolve));
    this.runtime?.wake();
    return settled;
  }

  restore(): Promise<void> {
    if (this.state === 'idle') return Promise.resolve();
    const done = new Promise<void>((resolve) => this.restoreWaiters.push(resolve));
    if (this.state === 'falling') {
      if (this.reduced() || this.options.restoreDuration <= 0) {
        this.reset();
        return done;
      }
      this.letGo(null);
      this.state = 'restoring';
      this.restoreTime = 0;
      for (const item of this.items) {
        const [dx, dy] = this.offset(item);
        // Turn back the short way round.
        const angle = Math.atan2(Math.sin(item.body.angle), Math.cos(item.body.angle));
        item.from = { x: dx, y: dy, angle };
      }
      this.settle();
      this.runtime?.wake();
    }
    return done;
  }

  toggle(): Promise<void> {
    return this.state === 'falling' ? this.restore() : this.drop();
  }

  explode(at?: { x: number; y: number }, strength = 1): Promise<void> {
    const settled = this.drop();
    if (this.state !== 'falling') return settled;
    let x = at?.x;
    let y = at?.y;
    if (x === undefined || y === undefined) {
      const rect = this.element.getBoundingClientRect();
      const top = Math.max(0, rect.top);
      const bottom = Math.min(document.documentElement.clientHeight, rect.bottom);
      x = (Math.max(0, rect.left) + Math.min(document.documentElement.clientWidth, rect.right)) / 2;
      y = bottom > top ? (top + bottom) / 2 : rect.top + rect.height / 2;
    }
    x += window.scrollX;
    y += window.scrollY;
    for (const { body } of this.items) {
      const dx = body.x - x;
      const dy = body.y - y;
      const distance = Math.hypot(dx, dy) || 1;
      // Closer elements fly harder, and everything gets a little lift.
      const speed = (strength * 2400) / (1 + distance / 400);
      body.vx += (dx / distance) * speed;
      body.vy += (dy / distance) * speed - strength * 300;
      body.w += (Math.random() * 2 - 1) * 8 * strength;
      body.wake();
    }
    this.runtime?.wake();
    return settled;
  }

  set(options: GravityOptions): void {
    const trigger = this.options.trigger;
    this.options = resolveOptions(options, this.options);
    this.runtime?.setRespectReducedMotion(this.options.respectReducedMotion);
    if (isBrowser && this.options.trigger !== trigger) this.armTrigger();
    if (!this.world) return;
    this.world.gravity = this.options.gravity;
    for (const { body } of this.items) {
      body.restitution = this.options.bounce;
      body.friction = this.options.friction;
      body.wake();
    }
    this.runtime?.wake();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.reset();
    this.disarm();
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
    this.runtime?.destroy();
  }

  private disarm: () => void = () => {};

  /** Sets up whatever makes the page fall by itself: load, the Konami code, idleness or a click. */
  private armTrigger(): void {
    this.disarm();
    const stops: (() => void)[] = [];
    this.disarm = () => {
      for (const stop of stops) stop();
      this.disarm = () => {};
    };
    const on = <E extends Event>(target: EventTarget, type: string, handler: (event: E) => void): void => {
      const listener = handler as EventListener;
      target.addEventListener(type, listener, { passive: true });
      stops.push(() => target.removeEventListener(type, listener));
    };
    const trigger = this.options.trigger;

    if (trigger === 'load') {
      // Wait for images and fonts so everything is measured at its real size.
      const go = (): void => {
        const frame = requestAnimationFrame(() => void this.drop());
        stops.push(() => cancelAnimationFrame(frame));
      };
      if (document.readyState === 'complete') go();
      else on(window, 'load', go);
    } else if (trigger === 'konami') {
      const code = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
      let progress = 0;
      on(window, 'keydown', (event: KeyboardEvent) => {
        const key = event.key.toLowerCase();
        progress = key === code[progress] ? progress + 1 : key === code[0] ? 1 : 0;
        if (progress === code.length) {
          progress = 0;
          void this.toggle();
        }
      });
    } else if (typeof trigger === 'object' && 'idle' in trigger) {
      let timer = 0;
      const restart = (): void => {
        clearTimeout(timer);
        if (this.state === 'idle') timer = window.setTimeout(() => void this.drop(), trigger.idle * 1000);
      };
      for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart']) on(window, type, restart);
      stops.push(() => clearTimeout(timer));
      restart();
    } else if (typeof trigger === 'object' && 'click' in trigger) {
      on(document, 'click', (event: MouseEvent) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target || event.defaultPrevented) return;
        const hit = typeof trigger.click === 'string' ? target.closest(trigger.click) : trigger.click.contains(target);
        if (hit) void this.toggle();
      });
    }
  }

  private reduced(): boolean {
    return this.options.respectReducedMotion && prefersReducedMotion();
  }

  private listen<E extends Event>(target: EventTarget, type: string, handler: (event: E) => void, options?: AddEventListenerOptions): void {
    const listener = handler as EventListener;
    target.addEventListener(type, listener, options);
    this.cleanups.push(() => target.removeEventListener(type, listener, options));
  }

  /** Measures the elements that will fall and builds the physics world around them. */
  private start(): void {
    const { options } = this;
    let elements = pickElements(this.element, options.selector, options.onlyVisible, options.maxBodies);
    if (options.splitText) {
      this.split = splitText(elements, options.splitText, options.maxBodies);
      elements = this.split.bodies;
    }
    const targets = elements as Styled[];

    // Read, then write, then read again, so the page lays out only twice.
    const inline = targets.map((el) => getComputedStyle(el).display === 'inline');
    const items: Item[] = targets.map((el, i) => {
      const item: Item = { element: el, body: null as unknown as Body, x0: 0, y0: 0, fixed: false, base: '', saved: new Map() };
      this.style(item, 'transition', 'none');
      if (inline[i]) this.style(item, 'display', 'inline-block');
      return item;
    });

    this.scrollX = window.scrollX;
    this.scrollY = window.scrollY;
    const fixedCache = new Map<Element, boolean>();
    const world = new World({ gravity: options.gravity });
    this.world = world;
    this.fitWalls();
    const room = this.room();
    for (const item of items) {
      const el = item.element;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      item.fixed = insideFixed(el, fixedCache);
      item.base = style.transform === 'none' ? '' : ` ${style.transform}`;
      item.x0 = rect.left + rect.width / 2 + this.scrollX;
      item.y0 = rect.top + rect.height / 2 + this.scrollY;
      // Layout size ignores the element's own transforms; fall back to its box.
      const html = el as unknown as HTMLElement;
      const width = Math.min(html.offsetWidth || rect.width, room.width - 4);
      const height = html.offsetHeight || rect.height;
      const radius = parseFloat(style.borderTopLeftRadius);
      const round = Math.abs(width - height) < 2 && radius >= width * 0.45;
      const body = new Body({
        x: item.x0,
        y: item.y0,
        width: Math.max(2, width),
        height: Math.max(2, height),
        shape: round ? 'circle' : 'box',
        friction: options.friction,
        restitution: options.bounce,
      });
      body.w = (Math.random() * 2 - 1) * options.spin;
      body.data = item;
      item.body = body;
      world.add(body);
    }
    for (const item of items) {
      this.style(item, 'transform-origin', '50% 50%');
      this.style(item, 'transform', item.base.trim() || 'none');
    }
    if (options.interactive) {
      for (const item of items) {
        this.style(item, 'touch-action', 'none');
        this.style(item, 'user-select', 'none');
        this.style(item, '-webkit-user-select', 'none');
        this.style(item, 'cursor', 'grab');
      }
    }
    for (const item of items) this.byElement.set(item.element, item);
    this.items = items;
    this.state = 'falling';
  }

  /** The fallen element under a pointer, if any. */
  private itemAt(target: EventTarget | null): Item | null {
    for (let node = target instanceof Element ? target : null; node && node !== this.element.parentElement; node = node.parentElement) {
      const item = this.byElement.get(node);
      if (item) return item;
    }
    return null;
  }

  private grabAt(event: PointerEvent): void {
    if (this.state !== 'falling' || !this.options.interactive || !this.world || this.drag) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const item = this.itemAt(event.target);
    if (!item) return;
    event.preventDefault();
    const x = event.clientX + window.scrollX;
    const y = event.clientY + window.scrollY;
    const grab = this.world.grab(item.body, x, y);
    this.drag = { grab, pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    // The dragged element goes on top and stays there.
    if (getComputedStyle(item.element).position === 'static') this.style(item, 'position', 'relative');
    this.style(item, 'z-index', '2147483000');
    this.style(item, 'cursor', 'grabbing');
    this.runtime?.wake();
  }

  private dragTo(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointer) return;
    if (Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 4) drag.moved = true;
    drag.grab.moveTo(event.clientX + window.scrollX, event.clientY + window.scrollY);
    this.runtime?.wake();
  }

  private letGo(event: PointerEvent | null): void {
    const drag = this.drag;
    if (!drag || (event && event.pointerId !== drag.pointer)) return;
    this.drag = null;
    this.world?.release(drag.grab);
    const item = drag.grab.body.data as Item;
    if (this.items.includes(item)) this.style(item, 'cursor', 'grab');
    if (drag.moved) {
      // A drag that ends over a link or button shouldn't also click it.
      const swallow = (click: Event): void => {
        click.preventDefault();
        click.stopPropagation();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    }
  }

  /** The area elements fall within, in document px. */
  private room(): { left: number; right: number; bottom: number; width: number } {
    const walls = this.options.walls ?? (this.element === document.body ? 'viewport' : 'root');
    let left: number;
    let right: number;
    let bottom: number;
    if (walls === 'viewport') {
      left = this.scrollX;
      right = left + document.documentElement.clientWidth;
      bottom = this.scrollY + document.documentElement.clientHeight;
    } else {
      const rect = this.element.getBoundingClientRect();
      left = rect.left + window.scrollX;
      right = rect.right + window.scrollX;
      bottom = rect.bottom + window.scrollY;
    }
    return { left, right, bottom, width: right - left };
  }

  /** Places the floor and side walls, e.g. after the window is resized. */
  private fitWalls(): void {
    const world = this.world;
    if (!world || this.state === 'restoring') return;
    for (const wall of this.walls) world.remove(wall);
    const { left, right, bottom, width } = this.room();
    const tall = 20000;
    this.walls = [
      new Body({ x: (left + right) / 2, y: bottom + WALL / 2, width: width + WALL * 2, height: WALL, density: 0 }),
      new Body({ x: left - WALL / 2, y: bottom - tall / 2, width: WALL, height: tall, density: 0 }),
      new Body({ x: right + WALL / 2, y: bottom - tall / 2, width: WALL, height: tall, density: 0 }),
    ];
    for (const wall of this.walls) world.add(wall);
    for (const { body } of this.items) body.wake();
    this.runtime?.wake();
  }

  private frame(dt: number): void {
    if (this.state === 'falling' && this.world) {
      this.world.step(dt);
      this.render();
      if (this.world.settled && this.canSleep()) {
        this.settle();
        this.runtime?.sleep();
      }
    } else if (this.state === 'restoring') {
      this.restoreTime += dt / this.options.restoreDuration;
      const t = Math.min(1, this.restoreTime);
      const k = 1 - easeInOut(t);
      for (const item of this.items) {
        const from = item.from!;
        this.place(item, from.x * k, from.y * k, from.angle * k);
      }
      if (t >= 1) this.reset();
    } else {
      this.runtime?.sleep();
    }
  }

  /** Whether nothing outside the physics (a drag, say) needs frames. */
  private canSleep(): boolean {
    return this.drag === null;
  }

  private offset(item: Item): [number, number] {
    let dx = item.body.x - item.x0;
    let dy = item.body.y - item.y0;
    if (item.fixed) {
      dx -= window.scrollX - this.scrollX;
      dy -= window.scrollY - this.scrollY;
    }
    return [dx, dy];
  }

  private render(): void {
    for (const item of this.items) {
      if (item.body.sleeping) continue;
      const [dx, dy] = this.offset(item);
      this.place(item, dx, dy, item.body.angle);
    }
  }

  private renderFixed(): void {
    if (this.state !== 'falling') return;
    for (const item of this.items) {
      if (!item.fixed) continue;
      const [dx, dy] = this.offset(item);
      this.place(item, dx, dy, item.body.angle);
    }
  }

  private place(item: Item, dx: number, dy: number, angle: number): void {
    const transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) rotate(${angle.toFixed(4)}rad)${item.base}`;
    item.element.style.setProperty('transform', transform, 'important');
  }

  /** Sets an inline style, remembering the original value to put back later. */
  private style(item: Item, property: string, value: string): void {
    const { style } = item.element;
    if (!item.saved.has(property)) item.saved.set(property, [style.getPropertyValue(property), style.getPropertyPriority(property)]);
    style.setProperty(property, value, 'important');
  }

  /** Physics positions take over from wherever the trip back had got to. */
  private resumeFromRestore(): void {
    const k = 1 - easeInOut(Math.min(1, this.restoreTime));
    for (const item of this.items) {
      const from = item.from!;
      const { body } = item;
      body.x = item.x0 + from.x * k + (item.fixed ? window.scrollX - this.scrollX : 0);
      body.y = item.y0 + from.y * k + (item.fixed ? window.scrollY - this.scrollY : 0);
      body.angle = from.angle * k;
      body.vx = body.vy = 0;
      body.w = (Math.random() * 2 - 1) * this.options.spin;
      body.wake();
      delete item.from;
    }
    this.state = 'falling';
    this.resolveRestore();
  }

  /** Puts every element back exactly as it was. */
  private reset(): void {
    this.letGo(null);
    for (const item of this.items) {
      const { style } = item.element;
      for (const [property, [value, priority]] of item.saved) {
        if (value) style.setProperty(property, value, priority);
        else style.removeProperty(property);
      }
      if (item.element.getAttribute('style') === '') item.element.removeAttribute('style');
    }
    this.split?.undo();
    this.split = null;
    this.byElement = new WeakMap();
    this.items = [];
    this.walls = [];
    this.world = null;
    this.state = 'idle';
    this.settle();
    this.resolveRestore();
    this.runtime?.sleep();
  }

  private settle(): void {
    const waiters = this.settleWaiters;
    this.settleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  private resolveRestore(): void {
    const waiters = this.restoreWaiters;
    this.restoreWaiters = [];
    for (const resolve of waiters) resolve();
  }
}

function insideFixed(element: Element, cache: Map<Element, boolean>): boolean {
  const chain: Element[] = [];
  let result = false;
  for (let node: Element | null = element; node; node = node.parentElement) {
    const known = cache.get(node);
    if (known !== undefined) {
      result = known;
      break;
    }
    chain.push(node);
    if (getComputedStyle(node).position === 'fixed') {
      result = true;
      break;
    }
  }
  for (const node of chain) cache.set(node, result);
  return result;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
