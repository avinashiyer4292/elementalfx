import { EffectRuntime, WindField, createRandom, isBrowser, pixelRatio, resolveElement } from '@elementalfx/core';
import { Lightning } from './lightning';
import {
  ALL_EFFECTS,
  mergeOptions,
  parseColor,
  resolveOptions,
  type ResolvedWeatherOptions,
  type WeatherEffect,
  type WeatherOptions,
} from './options';
import {
  EmberSystem,
  LeafSystem,
  RainSystem,
  SnowSystem,
  SplashSystem,
  SpriteBatch,
  type ParticleSystem,
  type SimContext,
} from './particles';
import { CanvasRenderer, GLRenderer, type FogFrame, type FrameData, type Renderer } from './render';
import { Surfaces } from './surfaces';

/** A running weather overlay. */
export interface Weather {
  /** The element the weather covers (`document.body` for the whole page). */
  readonly element: HTMLElement;
  readonly options: Readonly<ResolvedWeatherOptions>;
  /** The shared wind. Other effects can sample it so everything moves together. */
  readonly wind: WindField;
  /** Resolves to true once drawing, false if the effect can't run here. */
  readonly ready: Promise<boolean>;
  /** 'webgl2', 'canvas2d', or null when not drawing. */
  readonly renderer: 'webgl2' | 'canvas2d' | null;
  /** Turns an effect on. */
  add(effect: WeatherEffect): void;
  /** Turns an effect off; falling particles finish their fall. */
  remove(effect: WeatherEffect): void;
  /** Updates options. Nested groups (wind, snow, rain, …) merge key by key. */
  set(options: WeatherOptions): void;
  /** Triggers a lightning strike now, at `x` CSS px if given. */
  strike(x?: number): void;
  /** Removes settled snow from every surface. */
  clearSnow(): void;
  pause(): void;
  play(): void;
  /** Removes the overlay and restores the element. */
  destroy(): void;
  /** Live counts, for debugging and tests. */
  stats(): { particles: number; splashes: number; surfaces: number; settledSnow: number; flash: number };
}

/**
 * Covers an element (default: the whole page) with weather. Every effect
 * follows one shared wind field.
 */
export function createWeather(target: HTMLElement | string = 'body', options: WeatherOptions = {}): Weather {
  let element = isBrowser ? resolveElement(target) : (target as HTMLElement);
  if (isBrowser && element === document.documentElement) element = document.body;
  return new WeatherEffectImpl(element, options);
}

class WeatherEffectImpl implements Weather {
  readonly element: HTMLElement;
  readonly ready: Promise<boolean>;
  readonly wind: WindField;
  options: ResolvedWeatherOptions;

  private userOptions: WeatherOptions;
  private resolveReady!: (ok: boolean) => void;
  private settled = false;
  private runtime: EffectRuntime | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private drawer: Renderer | null = null;
  private restoreStyles: Array<() => void> = [];
  private cleanups: Array<() => void> = [];
  private mounted = false;
  private destroyed = false;
  private random: () => number;
  private systems = new Map<WeatherEffect, ParticleSystem>();
  private splashes = new SplashSystem();
  private lightning = new Lightning();
  private surfaces: Surfaces;
  private normal = new SpriteBatch();
  private additive = new SpriteBatch();
  private caps = { data: new Float32Array(3072) };
  private width = 0;
  private height = 0;
  private origin = { left: 0, top: 0 };
  private fogOffsetA: [number, number] = [0, 0];
  private fogOffsetB: [number, number] = [0, 0];
  private pointer: [number, number] = [-9999, -9999];
  private context: SimContext;
  private sizeDirty = true;

  constructor(element: HTMLElement, options: WeatherOptions) {
    this.element = element;
    this.userOptions = { ...options };
    this.options = resolveOptions(this.userOptions);
    this.wind = new WindField(this.options.wind);
    this.random = createRandom(this.options.seed || Math.floor(Math.random() * 2 ** 31));
    this.surfaces = new Surfaces(isBrowser ? document : ({} as ParentNode));
    this.ready = new Promise((resolve) => (this.resolveReady = resolve));
    this.context = {
      width: 0,
      height: 0,
      wind: this.wind,
      random: this.random,
      hitSurface: (x, prevY, y) => this.surfaces.hit(x, prevY, y),
      deposit: (x, y, amount) => this.surfaces.deposit(x, y, amount, this.options.maxSnowDepth),
      splash: (x, y, strength) => this.onSplash(x, y, strength),
    };
    if (!isBrowser) {
      this.settle(false);
      return;
    }
    this.surfaces.setSource(this.options.settleOn);
    this.syncSystems();
    this.runtime = new EffectRuntime({
      element,
      frame: (dt, now) => this.frame(dt, now),
      pauseOffscreen: this.options.pauseOffscreen,
      respectReducedMotion: this.options.respectReducedMotion,
      onReducedMotionChange: (reduce) => (reduce ? this.unmount() : this.mount()),
    });
    if (this.runtime.reducedMotion) this.settle(false);
    else this.mount();
  }

  get renderer(): 'webgl2' | 'canvas2d' | null {
    return this.drawer?.kind ?? null;
  }

  // ---------------------------------------------------------------- public API

  add(effect: WeatherEffect): void {
    if (!(ALL_EFFECTS as readonly string[]).includes(effect)) return;
    const effects = new Set(this.options.effects);
    effects.add(effect);
    this.set({ effects: [...effects] });
  }

  remove(effect: WeatherEffect): void {
    const effects = new Set(this.options.effects);
    effects.delete(effect);
    this.set({ effects: [...effects] });
  }

  set(options: WeatherOptions): void {
    if (this.destroyed) return;
    const previous = this.options;
    this.userOptions = mergeOptions(this.userOptions, options);
    // A new preset decides the effects unless they're given explicitly in this call.
    if (options.preset && !options.effects) delete this.userOptions.effects;
    this.options = resolveOptions(this.userOptions);
    this.wind.set(this.options.wind);
    if (previous.settleOn !== this.options.settleOn) this.surfaces.setSource(this.options.settleOn);
    if (previous.respectReducedMotion !== this.options.respectReducedMotion) {
      this.runtime?.setRespectReducedMotion(this.options.respectReducedMotion);
    }
    this.syncSystems();
    this.sizeDirty = true;
    if (this.mounted && (previous.forceCanvas2D !== this.options.forceCanvas2D || previous.layer !== this.options.layer || previous.zIndex !== this.options.zIndex)) {
      this.unmount();
      this.mount();
    }
    this.runtime?.wake();
  }

  strike(x?: number): void {
    if (!this.mounted) return;
    this.lightning.strike(this.width, this.height, this.random, this.options.lightning.flash, x);
    this.runtime?.wake();
  }

  clearSnow(): void {
    this.surfaces.clear();
  }

  pause(): void {
    this.runtime?.pause();
  }

  play(): void {
    this.runtime?.play();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.unmount();
    this.destroyed = true;
    this.runtime?.destroy();
    this.runtime = null;
    this.settle(false);
  }

  stats(): { particles: number; splashes: number; surfaces: number; settledSnow: number; flash: number } {
    let particles = 0;
    for (const system of this.systems.values()) particles += system.size;
    return {
      particles,
      splashes: this.splashes.size,
      surfaces: this.surfaces.count,
      settledSnow: this.surfaces.snow,
      flash: this.lightning.flash,
    };
  }

  // ------------------------------------------------------------- mount/unmount

  private get isPage(): boolean {
    return this.element === document.body;
  }

  private mount(): void {
    if (this.mounted || this.destroyed || this.runtime?.reducedMotion) return;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.dataset.fx = 'weather';
    const s = canvas.style;
    s.position = this.isPage ? 'fixed' : 'absolute';
    s.left = '0';
    s.top = '0';
    s.width = '100%';
    s.height = '100%';
    s.pointerEvents = 'none';
    s.display = 'block';
    const back = this.options.layer === 'back';
    if (this.isPage) {
      s.zIndex = back ? '-1' : String(this.options.zIndex);
      this.element.append(canvas);
    } else {
      const computed = getComputedStyle(this.element);
      if (computed.position === 'static') this.stash('position', 'relative');
      if (computed.zIndex === 'auto') this.stash('z-index', '0');
      s.zIndex = back ? '-1' : String(this.options.zIndex);
      if (back) this.element.prepend(canvas);
      else this.element.append(canvas);
    }
    this.canvas = canvas;
    this.drawer = (!this.options.forceCanvas2D && GLRenderer.create(canvas)) || CanvasRenderer.create(canvas);
    if (!this.drawer) {
      canvas.remove();
      this.canvas = null;
      this.settle(false);
      return;
    }
    this.mounted = true;
    this.listen();
    this.measure();
    for (const system of this.systems.values()) {
      system.resize(this.width, this.height, this.options.intensity);
      if (system.enabled) system.prefill(this.context);
    }
    this.renderFrame(0);
    this.runtime?.wake();
    this.settle(true);
  }

  private unmount(): void {
    if (!this.mounted) return;
    this.mounted = false;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.drawer?.destroy();
    this.drawer = null;
    this.canvas?.remove();
    this.canvas = null;
    for (const restore of this.restoreStyles.splice(0).reverse()) restore();
  }

  private stash(property: string, value: string): void {
    const element = this.element;
    const previous = element.style.getPropertyValue(property);
    element.style.setProperty(property, value);
    this.restoreStyles.push(() => {
      if (previous) element.style.setProperty(property, previous);
      else element.style.removeProperty(property);
    });
  }

  private listen(): void {
    const markDirty = (): void => {
      this.sizeDirty = true;
    };
    window.addEventListener('resize', markDirty);
    const observer = new ResizeObserver(markDirty);
    if (!this.isPage) observer.observe(this.element);
    let last: { x: number; y: number; t: number } | null = null;
    const move = (event: PointerEvent): void => {
      const x = event.clientX - this.origin.left;
      const y = event.clientY - this.origin.top;
      this.pointer = [x, y];
      const t = event.timeStamp;
      if (last && t > last.t) {
        const dt = Math.max(0.008, (t - last.t) / 1000);
        this.wind.push(x, y, (x - last.x) / dt, (y - last.y) / dt);
      }
      last = { x, y, t };
    };
    const leave = (): void => {
      last = null;
      this.pointer = [-9999, -9999];
    };
    window.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerleave', leave, { passive: true });
    this.cleanups.push(() => {
      window.removeEventListener('resize', markDirty);
      observer.disconnect();
      window.removeEventListener('pointermove', move);
      document.removeEventListener('pointerleave', leave);
    });
  }

  private measure(): void {
    if (!this.canvas || !this.drawer) return;
    let width: number;
    let height: number;
    if (this.isPage) {
      width = document.documentElement.clientWidth || window.innerWidth;
      height = window.innerHeight;
      this.origin = { left: 0, top: 0 };
    } else {
      const rect = this.canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      this.origin = { left: rect.left, top: rect.top };
    }
    width = Math.max(1, width);
    height = Math.max(1, height);
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.drawer.resize(width, height, pixelRatio(this.options.maxPixelRatio));
      this.wind.resize(width, height);
    }
    for (const system of this.systems.values()) system.resize(width, height, this.options.intensity);
    this.context.width = width;
    this.context.height = height;
    this.sizeDirty = false;
  }

  /** Creates, reconfigures and switches particle systems to match the options. */
  private syncSystems(): void {
    const o = this.options;
    const wanted: Array<[WeatherEffect, () => ParticleSystem]> = [
      ['snow', () => new SnowSystem(o.snow)],
      ['rain', () => new RainSystem(o.rain) as unknown as ParticleSystem],
      ['leaves', () => new LeafSystem(o.leaves)],
      ['embers', () => new EmberSystem(o.embers)],
    ];
    for (const [name, make] of wanted) {
      let system = this.systems.get(name);
      const on = o.effects.has(name);
      if (!system && on) {
        system = make();
        this.systems.set(name, system);
        if (this.mounted) {
          system.resize(this.width, this.height, o.intensity);
        }
      }
      if (!system) continue;
      system.configure(o[name] as never);
      system.enabled = on;
    }
  }

  // ------------------------------------------------------------------- frame

  private frame(dt: number, now: number): void {
    if (!this.mounted || !this.drawer) return;
    if (this.sizeDirty) this.measure();
    if (!this.isPage && this.canvas) {
      const rect = this.canvas.getBoundingClientRect();
      this.origin = { left: rect.left, top: rect.top };
    }
    this.wind.update(dt);
    this.surfaces.measure(this.origin.left, this.origin.top, now);
    for (const system of this.systems.values()) system.update(dt, this.context);
    this.splashes.update(dt);
    const lightning = this.options.lightning;
    this.lightning.update(dt, this.width, this.height, this.random, {
      enabled: this.options.effects.has('lightning'),
      rate: lightning.rate,
      flash: lightning.flash,
    });
    const snowing = this.options.effects.has('snow');
    this.surfaces.update(dt, snowing ? 0.02 : 1.5, this.options.maxSnowDepth);
    if (this.options.effects.has('fog')) {
      const base = this.wind.base();
      this.fogOffsetA[0] -= (base.x * 0.45 + 6) * dt;
      this.fogOffsetA[1] -= base.y * 0.45 * dt;
      this.fogOffsetB[0] -= (base.x * 0.8 + 10) * dt;
      this.fogOffsetB[1] -= base.y * 0.8 * dt;
    }
    this.renderFrame(dt);

    // Nothing left to animate: stop scheduling frames until something changes.
    const stats = this.stats();
    if (this.options.effects.size === 0 && stats.particles === 0 && stats.splashes === 0 && !this.lightning.active && stats.settledSnow === 0) {
      this.runtime?.sleep();
    }
  }

  private renderFrame(_dt: number): void {
    if (!this.drawer) return;
    this.normal.reset();
    this.additive.reset();
    for (const [name, system] of this.systems) {
      system.draw(name === 'embers' ? this.additive : this.normal);
    }
    this.splashes.draw(this.normal);
    const boltColor = parseColor(this.options.lightning.color);
    this.lightning.draw(this.additive, boltColor);
    const capVertices = this.surfaces.build(this.caps);
    const fogOptions = this.options.fog;
    const fog: FogFrame | null = this.options.effects.has('fog')
      ? {
          density: Math.max(0, Math.min(1, fogOptions.density)),
          color: parseColor(fogOptions.color),
          height: Math.max(0.05, Math.min(1, fogOptions.height)),
          offsetA: this.fogOffsetA,
          offsetB: this.fogOffsetB,
          pointer: this.pointer,
          pointerRadius: fogOptions.pointerRadius,
        }
      : null;
    const frame: FrameData = {
      width: this.width,
      height: this.height,
      normal: this.normal,
      additive: this.additive,
      caps: this.caps,
      capVertices,
      surfaces: this.surfaces,
      bolts: this.drawer.kind === 'canvas2d' ? this.lightning.lines() : [],
      fog,
      flash: this.lightning.flash * (this.options.layer === 'back' ? 0.6 : 1),
      flashColor: boltColor,
    };
    this.drawer.render(frame);
  }

  private onSplash(x: number, y: number, strength: number): void {
    const rain = this.options.rain;
    const color = parseColor(rain.colors[0] ?? '#b8cde0');
    this.splashes.emit(x, y, strength, this.random, color, rain.opacity[1]);
    for (const target of this.options.ripples) {
      if (this.random() > 0.5) continue;
      const rect = target.element.getBoundingClientRect();
      const cx = x + this.origin.left - rect.left;
      const cy = y + this.origin.top - rect.top;
      if (cx >= 0 && cy >= 0 && cx <= rect.width && cy <= rect.height) {
        target.drop(cx, cy, 5 + 9 * strength, 0.02 + 0.05 * strength);
      }
    }
  }

  private settle(ok: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveReady(ok);
  }
}
