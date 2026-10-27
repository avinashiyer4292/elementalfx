import { EffectRuntime, createRandom, isBrowser, noise3, pixelRatio, resolveElement } from '@elementalfx/core';
import {
  FULLSCREEN_VERTEX,
  PingPong,
  RenderTarget,
  createFullscreenDraw,
  createProgram,
  getWebGL2,
  isWebGL2Supported,
  simulationFormat,
  watchContextLoss,
  type Program,
  type TargetFormat,
} from '@elementalfx/gl';
import { ADVECT, CURL, DISPLAY, DIVERGENCE, GRADIENT_SUBTRACT, PRESSURE, SCALE, SPLAT, VORTICITY } from './shaders';
import { resolveOptions, tiers, type FluidMode, type FluidOptions, type QualityTier, type ResolvedFluidOptions } from './options';

/** A running fluid simulation. */
export interface Fluid {
  readonly element: HTMLElement;
  readonly options: Readonly<ResolvedFluidOptions>;
  /** 'cursor' or 'background'. */
  readonly mode: FluidMode;
  /** Resolves to true once drawing, false if the effect can't run here. */
  readonly ready: Promise<boolean>;
  /** Current quality tier. */
  readonly quality: 'low' | 'medium' | 'high';
  /**
   * Pushes the fluid at (x, y) CSS px from the area's top-left with velocity
   * (dx, dy) in CSS px, adding dye of `color` (hex) or the next palette color.
   */
  splat(x: number, y: number, dx: number, dy: number, color?: string): void;
  /** Fires `count` splats in random directions, around (x, y) if given. */
  burst(count?: number, at?: { x: number; y: number }): void;
  set(options: FluidOptions): void;
  /** Clears all dye and motion. */
  clear(): void;
  pause(): void;
  play(): void;
  destroy(): void;
}

interface GLState {
  gl: WebGL2RenderingContext;
  format: TargetFormat;
  programs: Record<'advect' | 'divergence' | 'curl' | 'vorticity' | 'scale' | 'pressure' | 'gradient' | 'splat' | 'display', Program>;
  quad: { draw(): void; delete(): void };
  velocity: PingPong;
  dye: PingPong;
  pressure: PingPong;
  divergence: RenderTarget;
  curl: RenderTarget;
  simSize: [number, number];
  dyeSize: [number, number];
}

/** Adds an interactive fluid simulation: a cursor trail over the page or a living background. */
export function createFluid(target: HTMLElement | string = 'body', options: FluidOptions = {}): Fluid {
  let element = isBrowser ? resolveElement(target) : (target as HTMLElement);
  if (isBrowser && element === document.documentElement) element = document.body;
  return new FluidEffect(element, options);
}

class FluidEffect implements Fluid {
  readonly element: HTMLElement;
  readonly ready: Promise<boolean>;
  options: ResolvedFluidOptions;

  private userOptions: FluidOptions;
  private resolveReady!: (ok: boolean) => void;
  private settled = false;
  private runtime: EffectRuntime | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private state: GLState | null = null;
  private mounted = false;
  private destroyed = false;
  private cleanups: Array<() => void> = [];
  private restoreStyles: Array<() => void> = [];
  private random = createRandom(Math.floor(Math.random() * 2 ** 31));
  private tierIndex = 2;
  private width = 1;
  private height = 1;
  private idleTime = 0;
  private clock = 0;
  private wanderers: Array<{ x: number; y: number; heading: number; seed: number; color: [number, number, number]; colorAge: number }> = [];
  private frameTimes: number[] = [];
  private qualityCooldown = 3;
  private pointers = new Map<number, { x: number; y: number; color: [number, number, number]; colorAge: number }>();
  private resizeQueued = false;

  constructor(element: HTMLElement, options: FluidOptions) {
    this.element = element;
    this.userOptions = { ...options };
    this.options = resolveOptions(this.userOptions);
    this.ready = new Promise((resolve) => (this.resolveReady = resolve));
    if (!isBrowser || !isWebGL2Supported()) {
      this.settle(false);
      return;
    }
    this.tierIndex = this.initialTier();
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

  get mode(): FluidMode {
    return this.options.mode ?? (isBrowser && this.element === document.body ? 'cursor' : 'background');
  }

  get quality(): 'low' | 'medium' | 'high' {
    return tiers[this.tierIndex]!.name;
  }

  private get ambient(): number {
    return this.options.ambient ?? (this.mode === 'background' ? 1 : 0);
  }

  // ---------------------------------------------------------------- public API

  splat(x: number, y: number, dx: number, dy: number, color?: string): void {
    this.splatScaled(x, y, dx, dy, color ? hexToRgb(color) : this.nextColor(), 1, 1);
  }

  private splatScaled(x: number, y: number, dx: number, dy: number, rgb: [number, number, number], dyeScale: number, radiusScale: number): void {
    const state = this.state;
    if (!state) return;
    const scale = this.options.brightness * dyeScale;
    this.applySplat(state, x / this.width, 1 - y / this.height, dx / this.width, -dy / this.height, [rgb[0] * scale, rgb[1] * scale, rgb[2] * scale], radiusScale);
    this.idleTime = 0;
    this.runtime?.wake();
  }

  burst(count = 6, at?: { x: number; y: number }): void {
    for (let i = 0; i < count; i++) {
      const x = at ? at.x + (this.random() - 0.5) * 40 : this.random() * this.width;
      const y = at ? at.y + (this.random() - 0.5) * 40 : this.random() * this.height;
      const angle = this.random() * Math.PI * 2;
      const speed = (0.6 + this.random() * 0.8) * Math.min(this.width, this.height) * 0.35;
      this.splat(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed);
    }
  }

  set(options: FluidOptions): void {
    if (this.destroyed) return;
    const previous = this.options;
    this.userOptions = { ...this.userOptions, ...options };
    this.options = resolveOptions(this.userOptions);
    if (previous.respectReducedMotion !== this.options.respectReducedMotion) {
      this.runtime?.setRespectReducedMotion(this.options.respectReducedMotion);
    }
    if (previous.quality !== this.options.quality) {
      this.tierIndex = this.initialTier();
      if (this.state) this.allocate(this.state);
    }
    const remount =
      previous.mode !== this.options.mode || previous.zIndex !== this.options.zIndex || previous.maxPixelRatio !== this.options.maxPixelRatio;
    if (remount && this.mounted) {
      this.unmount();
      this.mount();
      return;
    }
    if (previous.interactive !== this.options.interactive) this.bindPointer();
    this.idleTime = 0;
    this.runtime?.wake();
  }

  clear(): void {
    if (!this.state) return;
    this.state.velocity.clear();
    this.state.dye.clear();
    this.state.pressure.clear();
    this.display();
  }

  pause(): void {
    this.runtime?.pause();
  }

  play(): void {
    this.idleTime = 0;
    this.runtime?.play();
    this.runtime?.wake();
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
    if (this.mounted || this.destroyed || this.runtime?.reducedMotion) return;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.dataset.fx = 'fluid';
    const s = canvas.style;
    s.left = '0';
    s.top = '0';
    s.width = '100%';
    s.height = '100%';
    s.display = 'block';
    s.pointerEvents = 'none';
    if (this.mode === 'cursor') {
      s.position = 'fixed';
      s.zIndex = String(this.options.zIndex);
      document.body.append(canvas);
    } else {
      const computed = getComputedStyle(this.element);
      if (computed.position === 'static') this.stash('position', 'relative');
      if (computed.zIndex === 'auto') this.stash('z-index', '0');
      s.position = 'absolute';
      s.zIndex = '-1';
      s.borderRadius = computed.borderRadius;
      this.element.prepend(canvas);
    }
    this.canvas = canvas;
    this.state = this.createGL();
    if (!this.state) {
      canvas.remove();
      this.canvas = null;
      for (const restore of this.restoreStyles.splice(0).reverse()) restore();
      this.settle(false);
      return;
    }
    this.mounted = true;
    this.cleanups.push(
      watchContextLoss(
        canvas,
        () => {
          this.state = null;
        },
        () => {
          this.state = this.createGL();
          this.runtime?.wake();
        },
      ),
    );
    const resize = (): void => {
      this.resizeQueued = true;
      this.runtime?.wake();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(this.mode === 'cursor' ? document.documentElement : this.element);
    window.addEventListener('resize', resize);
    this.cleanups.push(() => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
    });
    this.bindPointer();
    this.measure();
    if (this.mode === 'background') this.burst(5);
    this.display();
    this.idleTime = 0;
    this.runtime?.wake();
    this.settle(true);
  }

  private unmount(): void {
    if (!this.mounted) return;
    this.mounted = false;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.releaseGL();
    this.canvas?.remove();
    this.canvas = null;
    this.pointers.clear();
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

  private measure(): void {
    if (!this.canvas || !this.state) return;
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    const dpr = pixelRatio(this.options.maxPixelRatio);
    this.canvas.width = Math.max(1, Math.round(this.width * dpr));
    this.canvas.height = Math.max(1, Math.round(this.height * dpr));
    this.allocate(this.state);
    this.resizeQueued = false;
  }

  // ------------------------------------------------------------------- WebGL

  private createGL(): GLState | null {
    const canvas = this.canvas;
    if (!canvas) return null;
    const gl = getWebGL2(canvas, { powerPreference: 'low-power' });
    if (!gl) return null;
    try {
      const format = simulationFormat(gl, { precision: 'half' });
      if (format.packed) {
        console.warn('[elementalfx] fluid: this GPU cannot render to float textures, so the fluid is off.');
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return null;
      }
      const make = (source: string): Program => createProgram(gl, FULLSCREEN_VERTEX, source);
      const programs = {
        advect: make(ADVECT),
        divergence: make(DIVERGENCE),
        curl: make(CURL),
        vorticity: make(VORTICITY),
        scale: make(SCALE),
        pressure: make(PRESSURE),
        gradient: make(GRADIENT_SUBTRACT),
        splat: make(SPLAT),
        display: make(DISPLAY),
      };
      const state = {
        gl,
        format,
        programs,
        quad: createFullscreenDraw(gl),
        simSize: [0, 0],
        dyeSize: [0, 0],
      } as unknown as GLState;
      this.allocate(state);
      return state;
    } catch (error) {
      console.warn('[elementalfx] fluid: WebGL setup failed.', error);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return null;
    }
  }

  /** (Re)creates simulation textures for the current size and quality tier. */
  private allocate(state: GLState): void {
    const tier = tiers[this.tierIndex]!;
    const sim = gridSize(tier.sim, this.width, this.height);
    const dye = gridSize(tier.dye, this.width, this.height);
    const { gl, format } = state;
    if (state.simSize[0] !== sim[0] || state.simSize[1] !== sim[1]) {
      state.velocity?.delete();
      state.pressure?.delete();
      state.divergence?.delete();
      state.curl?.delete();
      state.velocity = new PingPong(gl, sim[0], sim[1], format);
      state.pressure = new PingPong(gl, sim[0], sim[1], format);
      state.divergence = new RenderTarget(gl, sim[0], sim[1], format);
      state.curl = new RenderTarget(gl, sim[0], sim[1], format);
      state.simSize = sim;
    }
    if (state.dyeSize[0] !== dye[0] || state.dyeSize[1] !== dye[1]) {
      state.dye?.delete();
      state.dye = new PingPong(gl, dye[0], dye[1], format);
      state.dyeSize = dye;
    }
  }

  private releaseGL(): void {
    const state = this.state;
    this.state = null;
    if (!state) return;
    const { gl } = state;
    if (!gl.isContextLost()) {
      for (const program of Object.values(state.programs)) program.delete();
      state.quad.delete();
      state.velocity.delete();
      state.dye.delete();
      state.pressure.delete();
      state.divergence.delete();
      state.curl.delete();
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  /** Runs one pass: binds textures to units in order, sets uniforms, draws into `target`. */
  private pass(
    state: GLState,
    program: Program,
    target: RenderTarget | null,
    textures: Record<string, WebGLTexture>,
    uniforms: (u: Record<string, WebGLUniformLocation>) => void,
  ): void {
    const { gl } = state;
    program.use();
    let unit = 0;
    for (const [name, texture] of Object.entries(textures)) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      const location = program.uniforms[name];
      if (location) gl.uniform1i(location, unit);
      unit++;
    }
    uniforms(program.uniforms);
    if (target) target.bind();
    else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    }
    state.quad.draw();
  }

  private applySplat(state: GLState, u: number, v: number, du: number, dv: number, color: [number, number, number], radiusScale = 1): void {
    const { gl } = state;
    gl.disable(gl.BLEND);
    const aspect = this.width / this.height;
    const radius = (this.options.splatRadius / 100) * (aspect > 1 ? aspect : 1) * radiusScale;
    const force = this.options.splatForce;
    const p = state.programs.splat;
    this.pass(state, p, state.velocity.write, { uTarget: state.velocity.read.texture }, (uni) => {
      gl.uniform1f(uni.uAspect!, aspect);
      gl.uniform2f(uni.uPoint!, u, v);
      gl.uniform3f(uni.uValue!, du * force, dv * force, 0);
      gl.uniform1f(uni.uRadius!, radius);
    });
    state.velocity.swap();
    this.pass(state, p, state.dye.write, { uTarget: state.dye.read.texture }, (uni) => {
      gl.uniform1f(uni.uAspect!, aspect);
      gl.uniform2f(uni.uPoint!, u, v);
      gl.uniform3f(uni.uValue!, color[0], color[1], color[2]);
      gl.uniform1f(uni.uRadius!, radius);
    });
    state.dye.swap();
  }

  private step(state: GLState, dt: number): void {
    const { gl, programs } = state;
    const tier = tiers[this.tierIndex]!;
    const simTexel: [number, number] = [1 / state.simSize[0], 1 / state.simSize[1]];
    const o = this.options;
    gl.disable(gl.BLEND);
    const texel = (u: Record<string, WebGLUniformLocation>, t: [number, number] = simTexel): void => {
      if (u.uTexel) gl.uniform2f(u.uTexel, t[0], t[1]);
    };

    this.pass(state, programs.curl, state.curl, { uVelocity: state.velocity.read.texture }, (u) => texel(u));
    this.pass(state, programs.vorticity, state.velocity.write, { uVelocity: state.velocity.read.texture, uCurl: state.curl.texture }, (u) => {
      texel(u);
      gl.uniform1f(u.uCurlStrength!, o.curl);
      gl.uniform1f(u.uDt!, dt);
    });
    state.velocity.swap();
    this.pass(state, programs.divergence, state.divergence, { uVelocity: state.velocity.read.texture }, (u) => texel(u));
    this.pass(state, programs.scale, state.pressure.write, { uSource: state.pressure.read.texture }, (u) => {
      texel(u);
      gl.uniform1f(u.uValue!, Math.max(0, Math.min(1, o.pressure)));
    });
    state.pressure.swap();
    for (let i = 0; i < tier.iterations; i++) {
      this.pass(state, programs.pressure, state.pressure.write, { uPressure: state.pressure.read.texture, uDivergence: state.divergence.texture }, (u) => texel(u));
      state.pressure.swap();
    }
    this.pass(state, programs.gradient, state.velocity.write, { uPressure: state.pressure.read.texture, uVelocity: state.velocity.read.texture }, (u) => texel(u));
    state.velocity.swap();
    this.pass(state, programs.advect, state.velocity.write, { uVelocity: state.velocity.read.texture, uSource: state.velocity.read.texture }, (u) => {
      texel(u);
      gl.uniform1f(u.uDt!, dt);
      gl.uniform1f(u.uDissipation!, o.velocityDissipation);
    });
    state.velocity.swap();
    this.pass(state, programs.advect, state.dye.write, { uVelocity: state.velocity.read.texture, uSource: state.dye.read.texture }, (u) => {
      texel(u);
      gl.uniform1f(u.uDt!, dt);
      gl.uniform1f(u.uDissipation!, o.dyeDissipation);
    });
    state.dye.swap();
  }

  private display(): void {
    const state = this.state;
    if (!state) return;
    const { gl } = state;
    gl.disable(gl.BLEND);
    this.pass(state, state.programs.display, null, { uDye: state.dye.read.texture }, (u) => {
      gl.uniform2f(u.uTexel!, 1 / state.dyeSize[0], 1 / state.dyeSize[1]);
      gl.uniform1f(u.uOpacity!, Math.max(0, Math.min(1, this.options.opacity)));
      gl.uniform1f(u.uShading!, Math.max(0, Math.min(1, this.options.shading)));
    });
  }

  // ------------------------------------------------------------------- frame

  private frame(dt: number): void {
    const state = this.state;
    if (!state || state.gl.isContextLost()) return;
    if (this.resizeQueued) this.measure();
    this.adaptQuality(dt);

    const ambient = this.ambient;
    this.updateWanderers(dt, Math.round(ambient));
    for (const pointer of this.pointers.values()) pointer.colorAge += dt;

    this.step(state, Math.min(dt, 1 / 30));
    this.display();

    this.idleTime += dt;
    const settleTime = Math.max(4, 7 / Math.max(0.1, this.options.dyeDissipation));
    if (ambient <= 0 && this.idleTime > settleTime) {
      this.clear();
      this.runtime?.sleep();
    }
  }

  /**
   * Invisible strokes that drift around the area like a slow cursor, so a
   * background keeps flowing without anyone touching it.
   */
  private updateWanderers(dt: number, count: number): void {
    while (this.wanderers.length < count) {
      this.wanderers.push({
        x: this.random() * this.width,
        y: this.random() * this.height,
        heading: this.random() * Math.PI * 2,
        seed: this.random() * 100,
        color: this.nextColor(),
        colorAge: 0,
      });
    }
    this.wanderers.length = Math.max(0, count);
    this.clock += dt;
    const speed = Math.min(this.width, this.height) * 0.55;
    for (const w of this.wanderers) {
      // Steer with smooth noise; turn back toward the middle near the edges.
      w.heading += noise3(this.clock * 0.35, w.seed, 0) * dt * 3.2;
      const margin = Math.min(this.width, this.height) * 0.22;
      const edge = Math.min(w.x, w.y, this.width - w.x, this.height - w.y);
      if (edge < margin) {
        const toCenter = Math.atan2(this.height / 2 - w.y, this.width / 2 - w.x);
        w.heading += Math.sin(toCenter - w.heading) * dt * 7 * (1 - edge / margin);
      }
      const dx = Math.cos(w.heading) * speed * dt;
      const dy = Math.sin(w.heading) * speed * dt;
      w.x += dx;
      w.y += dy;
      // Bounce off the bounds if steering wasn't enough.
      if (w.x < 0 || w.x > this.width) {
        w.heading = Math.PI - w.heading;
        w.x = Math.max(0, Math.min(this.width, w.x));
      }
      if (w.y < 0 || w.y > this.height) {
        w.heading = -w.heading;
        w.y = Math.max(0, Math.min(this.height, w.y));
      }
      w.colorAge += dt;
      if (w.colorAge > 2.5) {
        w.color = this.nextColor();
        w.colorAge = 0;
      }
      // Wandering strokes splat every frame, so they carry less dye than a pointer.
      this.splatScaled(w.x, w.y, dx, dy, w.color, 0.22, 0.45);
    }
  }

  /** In 'auto' quality, steps down a tier when frames stay slower than ~40 fps. */
  private adaptQuality(dt: number): void {
    if (this.options.quality !== 'auto' || this.tierIndex === 0) return;
    this.qualityCooldown -= dt;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    if (this.qualityCooldown > 0 || this.frameTimes.length < 90) return;
    const average = this.frameTimes.reduce((sum, t) => sum + t, 0) / this.frameTimes.length;
    if (average > 1 / 40) {
      this.tierIndex--;
      this.frameTimes = [];
      this.qualityCooldown = 3;
      if (this.state) this.allocate(this.state);
    }
  }

  private initialTier(): number {
    const quality = this.options.quality;
    if (quality !== 'auto') return tiers.findIndex((tier: QualityTier) => tier.name === quality);
    const coarse = isBrowser && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    return coarse ? 1 : 2;
  }

  // ------------------------------------------------------------------ input

  private pointerCleanup: (() => void) | null = null;

  private bindPointer(): void {
    this.pointerCleanup?.();
    this.pointerCleanup = null;
    if (!this.options.interactive || !this.mounted) return;
    const target: EventTarget = this.mode === 'cursor' ? window : this.element;
    const local = (event: PointerEvent): { x: number; y: number } => {
      const rect = this.canvas!.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const move = (event: Event): void => {
      const e = event as PointerEvent;
      const point = local(e);
      const pointer = this.pointers.get(e.pointerId);
      if (!pointer) {
        this.pointers.set(e.pointerId, { ...point, color: this.nextColor(), colorAge: 0 });
        return;
      }
      const dx = point.x - pointer.x;
      const dy = point.y - pointer.y;
      pointer.x = point.x;
      pointer.y = point.y;
      if (dx === 0 && dy === 0) return;
      if (pointer.colorAge > 0.6) {
        pointer.color = this.nextColor();
        pointer.colorAge = 0;
      }
      this.splatScaled(point.x, point.y, dx, dy, pointer.color, 1, 1);
    };
    const down = (event: Event): void => {
      const e = event as PointerEvent;
      const point = local(e);
      this.pointers.set(e.pointerId, { ...point, color: this.nextColor(), colorAge: 0 });
      this.burst(3, point);
    };
    const up = (event: Event): void => {
      const e = event as PointerEvent;
      if (e.pointerType !== 'mouse') this.pointers.delete(e.pointerId);
    };
    target.addEventListener('pointermove', move, { passive: true });
    target.addEventListener('pointerdown', down, { passive: true });
    target.addEventListener('pointerup', up, { passive: true });
    target.addEventListener('pointercancel', up, { passive: true });
    this.pointerCleanup = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerdown', down);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    this.cleanups.push(() => {
      this.pointerCleanup?.();
      this.pointerCleanup = null;
    });
  }

  private nextColor(): [number, number, number] {
    const colors = this.options.colors;
    if (colors === 'rainbow' || colors.length === 0) return hsvToRgb(this.random(), 1, 1);
    return hexToRgb(colors[Math.floor(this.random() * colors.length)]!);
  }

  private settle(ok: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveReady(ok);
  }
}

/** Grid size with `resolution` cells along the shorter side, matching the area's aspect. */
function gridSize(resolution: number, width: number, height: number): [number, number] {
  const aspect = width / height;
  const short = Math.round(resolution);
  const long = Math.round(resolution * (aspect >= 1 ? aspect : 1 / aspect));
  return aspect >= 1 ? [long, short] : [short, long];
}

function hexToRgb(hex: string): [number, number, number] {
  let value = hex.trim().replace('#', '');
  if (value.length === 3) value = value.replace(/./g, (c) => c + c);
  const n = Number.parseInt(value, 16);
  if (value.length !== 6 || Number.isNaN(n)) return [1, 1, 1];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}
