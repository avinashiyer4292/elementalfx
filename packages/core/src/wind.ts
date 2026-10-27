import { clamp, noise3 } from './noise';

export interface WindOptions {
  /**
   * Direction the wind blows toward, in degrees. 0 blows left to right,
   * 180 right to left, 90 straight down, -90 straight up. Default 0.
   */
  direction?: number;
  /** Base strength from 0 (still air) to 1 (about 500 CSS px/s). Default 0.2. */
  speed?: number;
  /** How much the strength rises and falls over time, 0 to 1. Default 0.3. */
  gusts?: number;
  /** Small-scale swirling, 0 to 1. Default 0.3. */
  turbulence?: number;
  /** How strongly pointer movement pushes the air, 0 to 1. Default 0.5. */
  pointer?: number;
}

export interface WindSample {
  x: number;
  y: number;
}

interface Disturbance {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  life: number;
}

const MAX_SPEED = 500; // CSS px/s at speed 1
const TURBULENCE_SPEED = 160;
const CELL = 64; // grid cell size in CSS px
const DISTURBANCE_LIFE = 0.9; // seconds
const MAX_DISTURBANCES = 24;

export const defaultWind: Required<WindOptions> = {
  direction: 0,
  speed: 0.2,
  gusts: 0.3,
  turbulence: 0.3,
  pointer: 0.5,
};

/**
 * A shared 2D wind field in CSS pixels per second. Every effect that samples
 * the same field moves consistently: rain slants, snow drifts and embers blow
 * the same way. The swirl component is curl noise cached on a coarse grid and
 * refreshed once per update, so sampling thousands of particles stays cheap.
 */
export class WindField {
  options: Required<WindOptions>;
  /** Current gust multiplier applied to the base speed. */
  gust = 1;
  private time = 0;
  private width = 0;
  private height = 0;
  private cols = 0;
  private rows = 0;
  private grid = new Float32Array(0);
  private disturbances: Disturbance[] = [];

  constructor(options: WindOptions = {}) {
    this.options = { ...defaultWind, ...options };
  }

  set(options: WindOptions): void {
    this.options = { ...this.options, ...options };
  }

  /** Base wind vector without swirl or pointer pushes, in px/s. */
  base(out: WindSample = { x: 0, y: 0 }): WindSample {
    const angle = (this.options.direction * Math.PI) / 180;
    const strength = this.options.speed * MAX_SPEED * this.gust;
    out.x = Math.cos(angle) * strength;
    out.y = Math.sin(angle) * strength;
    return out;
  }

  /** Sets the area the field covers, in CSS px. */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.cols = Math.max(2, Math.ceil(width / CELL) + 1);
    this.rows = Math.max(2, Math.ceil(height / CELL) + 1);
    this.grid = new Float32Array(this.cols * this.rows * 2);
    this.refreshGrid();
  }

  /** Advances time: gusts, swirl and decaying pointer pushes. */
  update(dt: number): void {
    this.time += dt;
    const gusts = this.options.gusts;
    const wave = noise3(this.time * 0.18, 0.5, 7.3) * 1.6 + noise3(this.time * 0.9, 3.1, 1.7) * 0.4;
    this.gust = Math.max(0, 1 + gusts * wave);
    for (const d of this.disturbances) d.life -= dt;
    this.disturbances = this.disturbances.filter((d) => d.life > 0);
    this.refreshGrid();
  }

  /**
   * Adds a local push, e.g. from pointer movement. `vx`/`vy` in px/s;
   * the push fades out within about a second.
   */
  push(x: number, y: number, vx: number, vy: number, radius = 120): void {
    const strength = this.options.pointer;
    if (strength <= 0) return;
    if (this.disturbances.length >= MAX_DISTURBANCES) this.disturbances.shift();
    const limit = 1500;
    this.disturbances.push({
      x,
      y,
      vx: clamp(vx, -limit, limit) * strength,
      vy: clamp(vy, -limit, limit) * strength,
      radius,
      life: DISTURBANCE_LIFE,
    });
  }

  /** Wind at a point in px/s, including base wind, gusts, swirl and pushes. */
  sample(x: number, y: number, out: WindSample = { x: 0, y: 0 }): WindSample {
    this.base(out);
    if (this.cols > 0 && this.options.turbulence > 0) {
      const gx = clamp(x / CELL, 0, this.cols - 1.001);
      const gy = clamp(y / CELL, 0, this.rows - 1.001);
      const cx = Math.floor(gx);
      const cy = Math.floor(gy);
      const fx = gx - cx;
      const fy = gy - cy;
      const i00 = (cy * this.cols + cx) * 2;
      const i10 = i00 + 2;
      const i01 = i00 + this.cols * 2;
      const i11 = i01 + 2;
      const g = this.grid;
      const top0 = g[i00]! + (g[i10]! - g[i00]!) * fx;
      const bottom0 = g[i01]! + (g[i11]! - g[i01]!) * fx;
      const top1 = g[i00 + 1]! + (g[i10 + 1]! - g[i00 + 1]!) * fx;
      const bottom1 = g[i01 + 1]! + (g[i11 + 1]! - g[i01 + 1]!) * fx;
      out.x += top0 + (bottom0 - top0) * fy;
      out.y += top1 + (bottom1 - top1) * fy;
    }
    for (const d of this.disturbances) {
      const dx = x - d.x;
      const dy = y - d.y;
      const falloff = Math.exp(-(dx * dx + dy * dy) / (d.radius * d.radius));
      if (falloff < 0.01) continue;
      const fade = d.life / DISTURBANCE_LIFE;
      out.x += d.vx * falloff * fade;
      out.y += d.vy * falloff * fade;
    }
    return out;
  }

  private refreshGrid(): void {
    const { turbulence } = this.options;
    if (this.cols === 0 || turbulence <= 0) return;
    const scale = 1 / 320;
    const t = this.time * 0.12;
    const e = 0.5; // finite-difference step in noise space
    const magnitude = turbulence * TURBULENCE_SPEED * (0.6 + 0.4 * this.gust);
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const nx = col * CELL * scale;
        const ny = row * CELL * scale;
        // Curl of a scalar noise potential gives divergence-free swirls.
        const dpdy = noise3(nx, ny + e, t) - noise3(nx, ny - e, t);
        const dpdx = noise3(nx + e, ny, t) - noise3(nx - e, ny, t);
        const index = (row * this.cols + col) * 2;
        this.grid[index] = dpdy * magnitude;
        this.grid[index + 1] = -dpdx * magnitude;
      }
    }
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }
}
