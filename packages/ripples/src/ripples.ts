import { EffectRuntime, createRandom, isBrowser, pixelRatio, randomBetween, resolveElement } from '@elementalfx/core';
import {
  FULLSCREEN_VERTEX,
  PingPong,
  createFullscreenDraw,
  createProgram,
  createTexture,
  getWebGL2,
  isSourceReady,
  isWebGL2Supported,
  loadImage,
  simulationFormat,
  sourceSize,
  uploadTexture,
  watchContextLoss,
  type ImageSource,
  type Program,
  type TargetFormat,
} from '@elementalfx/gl';
import { DROP_FRAGMENT, MAX_DROPS, RENDER_FRAGMENT, UPDATE_FRAGMENT } from './shaders';
import { StyleStash, backgroundRect, contentBox, firstBackgroundUrl, objectRect, type DrawRect } from './layout';
import { resolveOptions, type ResolvedRipplesOptions, type RipplesOptions } from './options';

/** A running ripple effect. Method names match jquery.ripples for easy migration. */
export interface Ripples {
  /** The element the effect was created on. */
  readonly element: HTMLElement;
  /** The current, fully resolved options. */
  readonly options: Readonly<ResolvedRipplesOptions>;
  /**
   * Resolves to true once the first frame is drawn, or false if the effect
   * can't run here (no WebGL2, no usable image, or reduced motion).
   */
  readonly ready: Promise<boolean>;
  /** True while the effect is drawn on screen. */
  readonly active: boolean;
  /** Adds a drop at (x, y) in CSS px from the effect area's top-left corner. */
  drop(x: number, y: number, radius?: number, strength?: number): void;
  /** Updates options. Changing `source` reloads the image. */
  set(options: Partial<RipplesOptions>): void;
  /** Freezes the simulation; the current frame stays visible. */
  pause(): void;
  play(): void;
  /** Removes the effect visually (the original image shows) and pauses it. */
  hide(): void;
  show(): void;
  /** Re-measures the element. Called automatically on resize. */
  updateSize(): void;
  /** Removes the effect and restores the element exactly as it was. */
  destroy(): void;
}

type Mode = 'background' | 'child' | 'self';

interface GLState {
  gl: WebGL2RenderingContext;
  format: TargetFormat;
  drop: Program;
  update: Program;
  render: Program;
  quad: { draw(): void; delete(): void };
  image: WebGLTexture;
  sim: PingPong | null;
}

const STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 4;

/**
 * Adds WebGL water ripples to an element's background image, to an image or
 * video inside it, or to an `<img>`/`<video>` element directly.
 */
export function createRipples(target: HTMLElement | string, options: RipplesOptions = {}): Ripples {
  let element = isBrowser ? resolveElement(target) : (target as HTMLElement);
  if (isBrowser && element === document.documentElement) element = document.body;
  return new RipplesEffect(element, options);
}

/** Whether ripples can run in this browser (WebGL2 is available). */
export function isSupported(): boolean {
  return isWebGL2Supported();
}

class RipplesEffect implements Ripples {
  readonly element: HTMLElement;
  readonly ready: Promise<boolean>;
  options: ResolvedRipplesOptions;

  private userOptions: RipplesOptions;
  private resolveReady!: (value: boolean) => void;
  private settled = false;
  private runtime: EffectRuntime | null = null;
  private mode: Mode | null = null;
  private media: HTMLImageElement | HTMLVideoElement | null = null;
  private source: ImageSource | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private glState: GLState | null = null;
  private stash = new StyleStash();
  private mounted = false;
  private hidden = false;
  private destroyed = false;
  private contextLost = false;
  private loadToken = 0;
  private cleanups: Array<() => void> = [];
  private drops: number[] = [];
  private accumulator = 0;
  private rainAccumulator = 0;
  private idleTime = 0;
  private lastPointer: { x: number; y: number } | null = null;
  private random = createRandom(Math.floor(Math.random() * 2 ** 31));
  private area = { width: 0, height: 0 };
  private drawRect: DrawRect = { x: 0, y: 0, width: 1, height: 1, repeatX: false, repeatY: false };
  private resizeFrame = 0;

  constructor(element: HTMLElement, options: RipplesOptions) {
    this.element = element;
    this.userOptions = { ...options };
    this.options = resolveOptions(this.userOptions);
    this.ready = new Promise((resolve) => (this.resolveReady = resolve));
    if (!isBrowser || !isWebGL2Supported()) {
      this.settle(false);
      return;
    }
    this.runtime = new EffectRuntime({
      element,
      frame: (dt) => this.frame(dt),
      pauseOffscreen: this.options.pauseOffscreen,
      respectReducedMotion: this.options.respectReducedMotion,
      onReducedMotionChange: (reduce) => (reduce ? this.unmount() : this.mount()),
    });
    if (this.runtime.reducedMotion) this.settle(false);
    else this.mount();
  }

  get active(): boolean {
    return this.mounted && !this.hidden && this.glState !== null;
  }

  // ---------------------------------------------------------------- public API

  drop(x: number, y: number, radius = this.options.dropRadius, strength = 0.14): void {
    if (!this.active || this.area.width === 0) return;
    if (this.drops.length >= MAX_DROPS * 4) return;
    const u = x / this.area.width;
    const v = 1 - y / this.area.height;
    if (u < -0.1 || u > 1.1 || v < -0.1 || v > 1.1) return;
    this.drops.push(u, v, radius / this.area.width, strength);
    this.idleTime = 0;
    this.runtime?.wake();
  }

  set(options: Partial<RipplesOptions>): void {
    if (this.destroyed) return;
    const previous = this.options;
    // Preset values sit beneath explicit options, so switching presets
    // swaps preset values while keeping anything set explicitly.
    this.userOptions = { ...this.userOptions, ...options };
    this.options = resolveOptions(this.userOptions);
    if (previous.respectReducedMotion !== this.options.respectReducedMotion) {
      this.runtime?.setRespectReducedMotion(this.options.respectReducedMotion);
    }
    const needsRemount =
      'source' in options ||
      previous.forcePacked !== this.options.forcePacked ||
      previous.resolution !== this.options.resolution ||
      previous.maxPixelRatio !== this.options.maxPixelRatio;
    if (needsRemount && this.mounted) {
      this.unmount();
      this.mount();
      return;
    }
    if (previous.interactive !== this.options.interactive) this.bindPointer();
    this.idleTime = 0;
    this.runtime?.wake();
  }

  pause(): void {
    this.runtime?.pause();
  }

  play(): void {
    this.idleTime = 0;
    this.runtime?.play();
    this.runtime?.wake();
  }

  hide(): void {
    if (this.hidden) return;
    this.hidden = true;
    this.unmount();
  }

  show(): void {
    if (!this.hidden) return;
    this.hidden = false;
    this.mount();
  }

  updateSize(): void {
    if (!this.mounted || !this.canvas || !this.glState) return;
    this.layout();
    this.render();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.unmount();
    this.destroyed = true;
    this.runtime?.destroy();
    this.runtime = null;
    this.settle(false);
  }

  // ------------------------------------------------------------- mount/unmount

  private mount(): void {
    if (this.mounted || this.destroyed || this.hidden || this.runtime?.reducedMotion) return;
    const detected = this.detect();
    if (!detected) {
      console.warn('[elementalfx] ripples: no image found. Set a background image, add an <img>, or pass `source`.');
      this.settle(false);
      return;
    }
    this.mounted = true;
    this.mode = detected.mode;
    this.media = detected.media;
    const token = ++this.loadToken;
    void detected.load().then(
      (source) => {
        if (token !== this.loadToken || !this.mounted) return;
        this.source = source;
        this.start();
      },
      (error: unknown) => {
        if (token !== this.loadToken) return;
        console.warn('[elementalfx] ripples: could not load the image.', error);
        this.unmount();
        this.settle(false);
      },
    );
  }

  private unmount(): void {
    if (!this.mounted) return;
    this.mounted = false;
    this.loadToken++;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.releaseGL();
    this.canvas?.remove();
    this.canvas = null;
    this.stash.restore();
    this.drops = [];
    this.lastPointer = null;
    cancelAnimationFrame(this.resizeFrame);
  }

  private detect(): { mode: Mode; media: HTMLImageElement | HTMLVideoElement | null; load: () => Promise<ImageSource> } | null {
    const el = this.element;
    const { source, crossOrigin } = this.options;
    if (el instanceof HTMLImageElement || el instanceof HTMLVideoElement) {
      return { mode: 'self', media: el, load: () => mediaSource(el, crossOrigin) };
    }
    if (source) {
      return {
        mode: 'background',
        media: null,
        load: () => (typeof source === 'string' ? loadImage(source, crossOrigin) : waitForSource(source)),
      };
    }
    const url = firstBackgroundUrl(getComputedStyle(el).backgroundImage);
    if (url) return { mode: 'background', media: null, load: () => loadImage(url, crossOrigin) };
    const media = el.querySelector<HTMLImageElement | HTMLVideoElement>('img, video');
    if (media) return { mode: 'child', media, load: () => mediaSource(media, crossOrigin) };
    return null;
  }

  /** Creates the canvas and GL resources once the image is available. */
  private start(): void {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.dataset.fx = 'ripples';
    const s = canvas.style;
    s.position = 'absolute';
    s.left = '0';
    s.top = '0';
    s.display = 'block';
    s.pointerEvents = 'none';
    s.margin = '0';
    s.padding = '0';
    s.border = '0';
    this.canvas = canvas;

    const el = this.element;
    const computed = getComputedStyle(el);
    if (this.mode === 'self') {
      this.media!.after(canvas);
      // Match the media's border radius so rounded images stay rounded.
      s.borderRadius = getComputedStyle(this.media!).borderRadius;
    } else if (el === document.body) {
      // Page background: cover the viewport behind all content, like background-attachment: fixed.
      s.position = 'fixed';
      s.zIndex = '-1';
      el.prepend(canvas);
    } else {
      if (computed.position === 'static') this.stash.set(el, 'position', 'relative');
      if (computed.zIndex === 'auto') this.stash.set(el, 'z-index', '0');
      s.zIndex = '-1';
      s.borderRadius = this.mode === 'background' ? computed.borderRadius : getComputedStyle(this.media!).borderRadius;
      el.prepend(canvas);
    }

    if (!this.initGL()) {
      this.unmount();
      this.settle(false);
      return;
    }

    // Hide the original only once we know we can draw a replacement.
    if (this.mode === 'background') this.stash.set(el, 'background-image', 'none');
    if (this.mode === 'child') this.stash.set(this.media!, 'opacity', '0');

    this.cleanups.push(
      watchContextLoss(
        canvas,
        () => {
          this.contextLost = true;
          this.glState = null;
        },
        () => {
          this.contextLost = false;
          if (this.initGL()) {
            this.layout();
            this.render();
          }
        },
      ),
    );
    this.observeSize();
    this.bindPointer();
    if (this.media instanceof HTMLVideoElement) {
      const video = this.media;
      const wake = (): void => {
        this.idleTime = 0;
        this.runtime?.wake();
      };
      video.addEventListener('play', wake);
      this.cleanups.push(() => video.removeEventListener('play', wake));
    }
    this.layout();
    this.render();
    this.idleTime = 0;
    this.runtime?.wake();
    this.settle(true);
  }

  // ------------------------------------------------------------------- WebGL

  private initGL(): boolean {
    const canvas = this.canvas;
    if (!canvas || !this.source) return false;
    const gl = getWebGL2(canvas, { powerPreference: 'low-power' });
    if (!gl) return false;
    try {
      const format = simulationFormat(gl, { precision: 'float', forcePacked: this.options.forcePacked });
      const defines = { PACKED: format.packed, MANUAL_FILTER: !format.filterable };
      const image = createTexture(gl);
      if (!this.uploadSource(gl, image)) {
        gl.deleteTexture(image);
        return false;
      }
      this.glState = {
        gl,
        format,
        drop: createProgram(gl, FULLSCREEN_VERTEX, DROP_FRAGMENT, defines),
        update: createProgram(gl, FULLSCREEN_VERTEX, UPDATE_FRAGMENT, defines),
        render: createProgram(gl, FULLSCREEN_VERTEX, RENDER_FRAGMENT, defines),
        quad: createFullscreenDraw(gl),
        image,
        sim: null,
      };
      return true;
    } catch (error) {
      console.warn('[elementalfx] ripples: WebGL setup failed.', error);
      return false;
    }
  }

  private uploadSource(gl: WebGL2RenderingContext, texture: WebGLTexture): boolean {
    const source = this.source!;
    try {
      const { width, height } = sourceSize(source);
      const big = width * height > 512 * 512;
      uploadTexture(gl, texture, source, big && !(source instanceof HTMLVideoElement));
      return true;
    } catch (error) {
      console.warn(
        '[elementalfx] ripples: the image could not be read. Cross-origin images need CORS headers and crossorigin="anonymous".',
        error,
      );
      return false;
    }
  }

  private releaseGL(): void {
    const state = this.glState;
    this.glState = null;
    if (!state) return;
    const { gl } = state;
    if (!gl.isContextLost()) {
      state.drop.delete();
      state.update.delete();
      state.render.delete();
      state.quad.delete();
      state.sim?.delete();
      gl.deleteTexture(state.image);
    }
    // Free the context now instead of waiting for garbage collection;
    // browsers allow only a handful of live WebGL contexts per page.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  // ------------------------------------------------------------------ layout

  /** Measures the effect area, sizes the canvas and simulation, and maps the image. */
  private layout(): void {
    const canvas = this.canvas;
    const state = this.glState;
    if (!canvas || !state || !this.source) return;
    const el = this.element;

    let areaRect: DOMRect;
    if (this.mode === 'background') {
      areaRect = el.getBoundingClientRect();
      canvas.style.left = '0';
      canvas.style.top = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      const own = canvas.getBoundingClientRect();
      areaRect = own.width > 0 ? own : areaRect;
    } else {
      // Align the canvas with the media element, whatever the containing block is.
      areaRect = this.media!.getBoundingClientRect();
      canvas.style.width = `${areaRect.width}px`;
      canvas.style.height = `${areaRect.height}px`;
      canvas.style.left = '0';
      canvas.style.top = '0';
      const origin = canvas.getBoundingClientRect();
      canvas.style.left = `${areaRect.left - origin.left}px`;
      canvas.style.top = `${areaRect.top - origin.top}px`;
    }

    const width = Math.max(1, areaRect.width);
    const height = Math.max(1, areaRect.height);
    this.area = { width, height };
    const dpr = pixelRatio(this.options.maxPixelRatio);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));

    const { width: iw, height: ih } = sourceSize(this.source);
    if (this.mode === 'background' && this.options.source) {
      const fit = { objectFit: this.options.fit, objectPosition: '50% 50%' };
      this.drawRect = objectRect(fit, { x: 0, y: 0, width, height }, iw || width, ih || height);
    } else if (this.mode === 'background') {
      this.drawRect = backgroundRect(getComputedStyle(el), width, height, iw || width, ih || height);
    } else {
      const style = getComputedStyle(this.media!);
      this.drawRect = objectRect(style, contentBox(style, width, height), iw || width, ih || height);
    }

    // Square simulation cells: `resolution` cells along the longer side.
    const resolution = Math.max(16, Math.min(1024, Math.round(this.options.resolution)));
    const simW = width >= height ? resolution : Math.max(8, Math.round((resolution * width) / height));
    const simH = width >= height ? Math.max(8, Math.round((resolution * height) / width)) : resolution;
    if (!state.sim || state.sim.width !== simW || state.sim.height !== simH) {
      state.sim?.delete();
      state.sim = new PingPong(state.gl, simW, simH, state.format);
    }
  }

  private observeSize(): void {
    const schedule = (): void => {
      cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = requestAnimationFrame(() => this.updateSize());
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(this.element);
    if (this.media && this.media !== this.element) observer.observe(this.media);
    if (this.mode === 'self' && this.element.parentElement) observer.observe(this.element.parentElement);
    window.addEventListener('resize', schedule);
    this.cleanups.push(() => {
      observer.disconnect();
      window.removeEventListener('resize', schedule);
    });
  }

  // ------------------------------------------------------------------ input

  private pointerCleanup: (() => void) | null = null;

  private bindPointer(): void {
    this.pointerCleanup?.();
    this.pointerCleanup = null;
    if (!this.options.interactive || !this.mounted) return;
    const target = this.mode === 'self' ? this.media! : this.element;
    const local = (event: PointerEvent): { x: number; y: number } | null => {
      if (!this.canvas) return null;
      const rect = this.canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const move = (event: PointerEvent): void => {
      const point = local(event);
      if (!point) return;
      const radius = this.options.dropRadius;
      const last = this.lastPointer;
      // Fill gaps along fast movements so the wake looks continuous.
      if (last) {
        const distance = Math.hypot(point.x - last.x, point.y - last.y);
        const steps = Math.min(6, Math.floor(distance / Math.max(4, radius * 0.75)));
        for (let i = 1; i <= steps; i++) {
          const t = i / (steps + 1);
          this.drop(last.x + (point.x - last.x) * t, last.y + (point.y - last.y) * t, radius, 0.01);
        }
      }
      this.drop(point.x, point.y, radius, 0.01);
      this.lastPointer = point;
    };
    const down = (event: PointerEvent): void => {
      const point = local(event);
      if (point) this.drop(point.x, point.y, this.options.dropRadius * 1.5, 0.14);
    };
    const leave = (): void => {
      this.lastPointer = null;
    };
    target.addEventListener('pointermove', move, { passive: true });
    target.addEventListener('pointerdown', down, { passive: true });
    target.addEventListener('pointerleave', leave, { passive: true });
    this.pointerCleanup = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerdown', down);
      target.removeEventListener('pointerleave', leave);
    };
    this.cleanups.push(() => {
      this.pointerCleanup?.();
      this.pointerCleanup = null;
    });
  }

  // ---------------------------------------------------------------- simulate

  private frame(dt: number): void {
    const state = this.glState;
    if (!state || !state.sim || this.contextLost) return;

    const rain = this.options.rain;
    if (rain && this.area.width > 0) {
      this.rainAccumulator += dt * rain.rate;
      while (this.rainAccumulator >= 1) {
        this.rainAccumulator -= 1;
        this.drop(
          this.random() * this.area.width,
          this.random() * this.area.height,
          randomBetween(this.random, rain.radius[0], rain.radius[1]),
          randomBetween(this.random, rain.strength[0], rain.strength[1]),
        );
      }
    }

    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= STEP && steps < MAX_STEPS_PER_FRAME) {
      this.step(state);
      this.accumulator -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;

    const video = this.media instanceof HTMLVideoElement ? this.media : null;
    const videoPlaying = video !== null && !video.paused && !video.ended;
    if (videoPlaying && isSourceReady(video)) this.uploadSource(state.gl, state.image);

    this.render();

    this.idleTime += dt;
    if (!rain && !videoPlaying && this.idleTime > this.options.idleTimeout) {
      // The water has settled: clear it, draw the plain image once and stop.
      state.sim.clear();
      this.render();
      this.runtime?.sleep();
    }
  }

  private step(state: GLState): void {
    const { gl, sim, quad } = state;
    if (!sim) return;
    gl.disable(gl.BLEND);
    const aspect = this.area.width / this.area.height;
    while (this.drops.length > 0) {
      const batch = this.drops.splice(0, MAX_DROPS * 4);
      const program = state.drop;
      program.use();
      sim.write.bind();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sim.read.texture);
      gl.uniform1i(program.uniforms.uState!, 0);
      gl.uniform2f(program.uniforms.uSimSize!, sim.width, sim.height);
      gl.uniform1f(program.uniforms.uAspect!, aspect);
      const data = new Float32Array(MAX_DROPS * 4);
      data.set(batch);
      gl.uniform4fv(program.uniforms.uDrops!, data);
      gl.uniform1i(program.uniforms.uDropCount!, batch.length / 4);
      quad.draw();
      sim.swap();
    }
    const program = state.update;
    program.use();
    sim.write.bind();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sim.read.texture);
    gl.uniform1i(program.uniforms.uState!, 0);
    gl.uniform2f(program.uniforms.uSimSize!, sim.width, sim.height);
    gl.uniform1f(program.uniforms.uDamping!, this.options.damping);
    quad.draw();
    sim.swap();
  }

  private render(): void {
    const state = this.glState;
    const canvas = this.canvas;
    if (!state || !state.sim || !canvas || this.contextLost) return;
    const { gl, sim, quad } = state;
    const program = state.render;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    program.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sim.read.texture);
    gl.uniform1i(program.uniforms.uState!, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, state.image);
    gl.uniform1i(program.uniforms.uImage!, 1);
    gl.uniform2f(program.uniforms.uSimSize!, sim.width, sim.height);
    const { width, height } = this.area;
    const r = this.drawRect;
    gl.uniform4f(program.uniforms.uImageTransform!, width / r.width, height / r.height, -r.x / r.width, -r.y / r.height);
    gl.uniform2f(program.uniforms.uRepeat!, r.repeatX ? 1 : 0, r.repeatY ? 1 : 0);
    gl.uniform1f(program.uniforms.uPerturbance!, this.options.perturbance);
    gl.uniform1f(program.uniforms.uHighlight!, this.options.highlight);
    gl.uniform1f(program.uniforms.uAspect!, width / height);
    quad.draw();
  }

  private settle(value: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveReady(value);
  }
}

/** Waits for an image/video element to have pixels; retries with CORS if the pixels are tainted. */
async function mediaSource(
  media: HTMLImageElement | HTMLVideoElement,
  crossOrigin: string | null,
): Promise<ImageSource> {
  await waitForSource(media);
  if (media instanceof HTMLImageElement && !canRead(media)) {
    // A cross-origin <img> without crossorigin="anonymous" can't be uploaded.
    // Load a CORS-enabled copy; this works if the server sends CORS headers.
    return loadImage(media.currentSrc || media.src, crossOrigin ?? 'anonymous');
  }
  return media;
}

function waitForSource(source: ImageSource): Promise<ImageSource> {
  if (isSourceReady(source)) return Promise.resolve(source);
  return new Promise((resolve, reject) => {
    const target = source as HTMLImageElement | HTMLVideoElement;
    const ready = (): void => {
      cleanup();
      resolve(source);
    };
    const failed = (): void => {
      cleanup();
      reject(new Error('[elementalfx] media failed to load'));
    };
    const cleanup = (): void => {
      target.removeEventListener('load', ready);
      target.removeEventListener('loadeddata', ready);
      target.removeEventListener('error', failed);
    };
    target.addEventListener('load', ready);
    target.addEventListener('loadeddata', ready);
    target.addEventListener('error', failed);
  });
}

/** Whether an image's pixels can be read by WebGL (same origin or CORS-approved). */
function canRead(image: HTMLImageElement): boolean {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) return true;
    context.drawImage(image, 0, 0, 1, 1);
    context.getImageData(0, 0, 1, 1);
    return true;
  } catch {
    return false;
  }
}

