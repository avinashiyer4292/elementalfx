import { randomBetween, type WindField, type WindSample } from '@elementalfx/core';
import { parseColor, type ParticleOptions, type RainOptions } from './options';

/** Sprite kinds understood by both renderers. */
export const Kind = { Snow: 0, Rain: 1, Leaf: 2, Ember: 3, Splash: 4, Bolt: 5 } as const;
export type Kind = (typeof Kind)[keyof typeof Kind];

/** Floats per sprite instance: x, y, width, height, angle, alpha, kind, r, g, b. */
export const SPRITE_STRIDE = 10;

/** A growable buffer of sprite instances, rebuilt every frame. */
export class SpriteBatch {
  data = new Float32Array(SPRITE_STRIDE * 256);
  count = 0;

  reset(): void {
    this.count = 0;
  }

  push(x: number, y: number, w: number, h: number, angle: number, alpha: number, kind: Kind, r: number, g: number, b: number): void {
    if ((this.count + 1) * SPRITE_STRIDE > this.data.length) {
      const grown = new Float32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    const o = this.count * SPRITE_STRIDE;
    const d = this.data;
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = w;
    d[o + 3] = h;
    d[o + 4] = angle;
    d[o + 5] = alpha;
    d[o + 6] = kind;
    d[o + 7] = r;
    d[o + 8] = g;
    d[o + 9] = b;
    this.count++;
  }
}

/** Everything a particle system needs from the weather each frame. */
export interface SimContext {
  width: number;
  height: number;
  wind: WindField;
  random: () => number;
  /** Returns the surface top (y) under x if a falling particle at prevY→y crosses one, else null. */
  hitSurface(x: number, prevY: number, y: number): number | null;
  /** Called for snow landing on a surface. */
  deposit(x: number, y: number, amount: number): void;
  /** Called where rain lands. */
  splash(x: number, y: number, strength: number): void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  depth: number;
  alpha: number;
  angle: number;
  spin: number;
  phase: number;
  phaseSpeed: number;
  life: number;
  maxLife: number;
  landY: number;
  color: [number, number, number];
}

const scratch: WindSample = { x: 0, y: 0 };

function blank(): Particle {
  return {
    x: 0, y: 0, vx: 0, vy: 0, size: 1, depth: 1, alpha: 1, angle: 0, spin: 0,
    phase: 0, phaseSpeed: 1, life: 0, maxLife: 1, landY: 0, color: [1, 1, 1],
  };
}

/**
 * A pool of particles that keeps itself at a target count. `count` is
 * per megapixel of covered area at density 1, before intensity.
 */
export abstract class ParticleSystem<O extends ParticleOptions = ParticleOptions> {
  protected particles: Particle[] = [];
  protected colors: Array<[number, number, number]> = [[1, 1, 1]];
  protected target = 0;
  /** True while the effect is switched on. Switched-off systems drain naturally. */
  enabled = true;

  constructor(
    protected options: Required<O>,
    private readonly perMegapixel: number,
    private readonly maxCount: number,
  ) {
    this.configure(options);
  }

  configure(options: Required<O>): void {
    this.options = options;
    const colors = (options as Required<ParticleOptions>).colors;
    this.colors = colors.length ? colors.map(parseColor) : [[1, 1, 1]];
  }

  /** Sets the target count for the covered area. */
  resize(width: number, height: number, intensity: number): void {
    const megapixels = (width * height) / 1_000_000;
    this.target = Math.min(
      this.maxCount,
      Math.round(this.perMegapixel * megapixels * (this.options as Required<ParticleOptions>).density * intensity),
    );
  }

  get size(): number {
    return this.particles.length;
  }

  /** Fills the area immediately, so weather is already under way on first paint. */
  prefill(context: SimContext): void {
    while (this.particles.length < this.target) {
      const particle = blank();
      this.spawn(particle, context, true);
      this.particles.push(particle);
    }
  }

  update(dt: number, context: SimContext): void {
    // Grow gradually so density changes fade in rather than pop.
    const growth = Math.max(1, Math.ceil(this.target * dt * 0.5));
    for (let i = 0; this.enabled && this.particles.length < this.target && i < growth; i++) {
      const particle = blank();
      this.spawn(particle, context, false);
      this.particles.push(particle);
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i]!;
      const alive = this.step(particle, dt, context);
      if (alive) continue;
      // Over target or switched off: let this particle go instead of recycling it.
      if (!this.enabled || this.particles.length > this.target) {
        this.particles[i] = this.particles[this.particles.length - 1]!;
        this.particles.pop();
      } else {
        this.spawn(particle, context, false);
      }
    }
  }

  abstract draw(batch: SpriteBatch): void;
  protected abstract spawn(particle: Particle, context: SimContext, anywhere: boolean): void;
  /** Advances one particle; returns false when it should respawn. */
  protected abstract step(particle: Particle, dt: number, context: SimContext): boolean;

  protected pickColor(random: () => number): [number, number, number] {
    return this.colors[Math.floor(random() * this.colors.length)] ?? [1, 1, 1];
  }

  /** Horizontal spawn range that keeps a steady stream entering the view under the current wind. */
  protected spawnX(context: SimContext, fallSpeed: number): number {
    const { width, height, wind, random } = context;
    const drift = (wind.base(scratch).x * height) / Math.max(30, fallSpeed);
    const from = Math.min(0, -drift) - 20;
    const to = Math.max(width, width - drift) + 20;
    return randomBetween(random, from, to);
  }
}

export class SnowSystem extends ParticleSystem {
  constructor(options: Required<ParticleOptions>) {
    super(options, 280, 3000);
  }

  protected spawn(p: Particle, c: SimContext, anywhere: boolean): void {
    const { random } = c;
    p.depth = 0.35 + random() * 0.65;
    p.size = randomBetween(random, this.options.size[0], this.options.size[1]) * (0.5 + 0.5 * p.depth);
    const fall = (28 + 60 * p.depth) * this.options.speed;
    p.vy = fall;
    p.vx = 0;
    p.landY = fall; // terminal fall speed
    p.alpha = randomBetween(random, this.options.opacity[0], this.options.opacity[1]) * (0.55 + 0.45 * p.depth);
    p.phase = random() * Math.PI * 2;
    p.phaseSpeed = 0.6 + random() * 1.2;
    p.spin = 10 + random() * 25; // sway amplitude in px/s
    p.x = this.spawnX(c, fall);
    p.y = anywhere ? random() * c.height : -p.size - random() * 40;
    p.color = this.pickColor(random);
  }

  protected step(p: Particle, dt: number, c: SimContext): boolean {
    const wind = c.wind.sample(p.x, p.y, scratch);
    const response = 0.35 + 0.65 * p.depth;
    const k = Math.min(1, dt * 1.6);
    p.vx += (wind.x * response - p.vx) * k;
    p.vy += (p.landY + wind.y * response - p.vy) * k;
    p.phase += p.phaseSpeed * dt;
    const prevY = p.y;
    p.x += (p.vx + Math.cos(p.phase) * p.spin) * dt;
    p.y += p.vy * dt;
    if (p.depth > 0.6) {
      const surface = c.hitSurface(p.x, prevY, p.y);
      if (surface !== null) {
        c.deposit(p.x, surface, p.size * 0.45);
        return false;
      }
    }
    return p.y < c.height + 12 && p.y > -80 && p.x > -c.width * 0.5 && p.x < c.width * 1.5;
  }

  draw(batch: SpriteBatch): void {
    for (const p of this.particles) {
      const [r, g, b] = p.color;
      batch.push(p.x, p.y, p.size * 2, p.size * 2, 0, p.alpha, Kind.Snow, r, g, b);
    }
  }
}

export class RainSystem extends ParticleSystem<RainOptions> {
  constructor(options: Required<RainOptions>) {
    super(options, 520, 5000);
  }

  protected spawn(p: Particle, c: SimContext, anywhere: boolean): void {
    const { random } = c;
    p.depth = 0.3 + random() * 0.7;
    p.size = randomBetween(random, this.options.size[0], this.options.size[1]) * (0.55 + 0.45 * p.depth);
    const fall = (850 + 450 * p.depth) * this.options.speed;
    p.vy = fall;
    p.vx = c.wind.base(scratch).x;
    p.phase = fall; // terminal fall speed
    p.alpha = randomBetween(random, this.options.opacity[0], this.options.opacity[1]) * (0.5 + 0.5 * p.depth);
    // Nearer drops land lower on the screen: a cheap sense of a ground plane.
    p.landY = c.height * (0.62 + 0.45 * p.depth) + random() * 30;
    p.x = this.spawnX(c, fall);
    p.y = anywhere ? random() * Math.min(p.landY, c.height) : -p.size - random() * 120;
    p.color = this.pickColor(random);
  }

  protected step(p: Particle, dt: number, c: SimContext): boolean {
    const wind = c.wind.sample(p.x, p.y, scratch);
    const k = Math.min(1, dt * 6);
    p.vx += (wind.x * 0.9 - p.vx) * k;
    p.vy += (p.phase + wind.y * 0.5 - p.vy) * k;
    const prevY = p.y;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.depth > 0.55) {
      const surface = c.hitSurface(p.x, prevY, p.y);
      if (surface !== null) {
        if (this.options.splashes) c.splash(p.x, surface, p.depth);
        return false;
      }
    }
    if (p.y >= p.landY) {
      if (p.landY < c.height && this.options.splashes) c.splash(p.x, p.landY, p.depth);
      return false;
    }
    return p.x > -c.width * 0.5 && p.x < c.width * 1.5;
  }

  draw(batch: SpriteBatch): void {
    for (const p of this.particles) {
      const [r, g, b] = p.color;
      const speed = Math.hypot(p.vx, p.vy) || 1;
      const length = p.size * (0.7 + 0.3 * Math.min(2, speed / 1000));
      // The streak trails behind the drop's head, along its velocity.
      const cx = p.x - (p.vx / speed) * length * 0.5;
      const cy = p.y - (p.vy / speed) * length * 0.5;
      batch.push(cx, cy, 1.2 + p.depth * 0.6, length, -Math.atan2(p.vx, p.vy), p.alpha, Kind.Rain, r, g, b);
    }
  }
}

export class LeafSystem extends ParticleSystem {
  constructor(options: Required<ParticleOptions>) {
    super(options, 30, 200);
  }

  protected spawn(p: Particle, c: SimContext, anywhere: boolean): void {
    const { random } = c;
    p.depth = 0.4 + random() * 0.6;
    p.size = randomBetween(random, this.options.size[0], this.options.size[1]) * (0.6 + 0.4 * p.depth);
    const fall = (45 + 70 * p.depth) * this.options.speed;
    p.landY = fall;
    p.vy = fall;
    p.vx = 0;
    p.alpha = randomBetween(random, this.options.opacity[0], this.options.opacity[1]);
    p.angle = random() * Math.PI * 2;
    p.spin = (random() - 0.5) * 3;
    p.phase = random() * Math.PI * 2;
    p.phaseSpeed = 1.2 + random() * 1.6;
    p.life = random() * Math.PI * 2; // flip phase
    p.x = this.spawnX(c, fall);
    p.y = anywhere ? random() * c.height : -p.size - random() * 60;
    p.color = this.pickColor(random);
  }

  protected step(p: Particle, dt: number, c: SimContext): boolean {
    const wind = c.wind.sample(p.x, p.y, scratch);
    const k = Math.min(1, dt * 1.2);
    // Leaves glide: fall speed and sideways drift oscillate as they rock.
    const glide = Math.sin(p.phase);
    p.vx += (wind.x * (0.6 + 0.4 * p.depth) + glide * 40 - p.vx) * k;
    p.vy += (p.landY * (0.55 + 0.45 * Math.abs(glide)) + wind.y * 0.7 - p.vy) * k;
    p.phase += p.phaseSpeed * dt;
    p.life += dt * (1.5 + Math.abs(p.spin));
    p.angle += p.spin * dt + glide * dt * 0.8;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    return p.y < c.height + 40 && p.x > -c.width * 0.5 && p.x < c.width * 1.5;
  }

  draw(batch: SpriteBatch): void {
    for (const p of this.particles) {
      const flip = Math.cos(p.life);
      const shade = flip < 0 ? 0.72 : 1;
      const [r, g, b] = p.color;
      batch.push(p.x, p.y, p.size, p.size * Math.max(0.18, Math.abs(flip)) * 0.75, p.angle, p.alpha, Kind.Leaf, r * shade, g * shade, b * shade);
    }
  }
}

export class EmberSystem extends ParticleSystem {
  constructor(options: Required<ParticleOptions>) {
    super(options, 120, 1200);
  }

  protected spawn(p: Particle, c: SimContext, anywhere: boolean): void {
    const { random } = c;
    p.depth = 0.4 + random() * 0.6;
    p.size = randomBetween(random, this.options.size[0], this.options.size[1]) * (0.6 + 0.4 * p.depth);
    const rise = (45 + 110 * p.depth) * this.options.speed;
    p.landY = rise;
    p.vy = -rise;
    p.vx = 0;
    p.maxLife = 2.2 + random() * 3;
    p.life = anywhere ? random() * p.maxLife : p.maxLife;
    p.alpha = randomBetween(random, this.options.opacity[0], this.options.opacity[1]);
    p.phase = random() * 20;
    p.phaseSpeed = 8 + random() * 10;
    p.x = randomBetween(random, -20, c.width + 20);
    p.y = anywhere ? c.height - random() * c.height * 0.8 : c.height + 6;
    p.color = this.pickColor(random);
  }

  protected step(p: Particle, dt: number, c: SimContext): boolean {
    const wind = c.wind.sample(p.x, p.y, scratch);
    const k = Math.min(1, dt * 2);
    p.vx += (wind.x * 0.8 - p.vx) * k;
    p.vy += (-p.landY + wind.y * 0.6 - p.vy) * k;
    p.phase += p.phaseSpeed * dt;
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    return p.life > 0 && p.y > -20;
  }

  draw(batch: SpriteBatch): void {
    for (const p of this.particles) {
      const t = Math.max(0, p.life / p.maxLife);
      const flicker = 0.75 + 0.25 * Math.sin(p.phase);
      // Cool from the picked color toward deep red as the ember dies.
      const [r, g, b] = p.color;
      const size = p.size * (0.5 + 0.5 * t);
      batch.push(p.x, p.y, size * 4, size * 4, 0, p.alpha * flicker * Math.min(1, t * 2.5), Kind.Ember, r, g * (0.55 + 0.45 * t), b * t);
    }
  }
}

/** Short-lived droplets thrown up where rain lands. */
export class SplashSystem {
  private particles: Particle[] = [];

  emit(x: number, y: number, strength: number, random: () => number, color: [number, number, number], alpha: number): void {
    if (this.particles.length > 900) return;
    const count = 1 + Math.floor(random() * 2 + strength);
    for (let i = 0; i < count; i++) {
      const p = blank();
      p.x = x;
      p.y = y;
      p.vx = (random() - 0.5) * 140 * strength;
      p.vy = -(60 + random() * 120) * strength;
      p.size = 1 + random() * 1.4 * strength;
      p.maxLife = p.life = 0.22 + random() * 0.2;
      p.alpha = alpha;
      p.color = color;
      this.particles.push(p);
    }
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt;
      p.vy += 900 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life <= 0) {
        this.particles[i] = this.particles[this.particles.length - 1]!;
        this.particles.pop();
      }
    }
  }

  get size(): number {
    return this.particles.length;
  }

  draw(batch: SpriteBatch): void {
    for (const p of this.particles) {
      const [r, g, b] = p.color;
      batch.push(p.x, p.y, p.size * 2, p.size * 2, 0, p.alpha * (p.life / p.maxLife), Kind.Splash, r, g, b);
    }
  }
}
