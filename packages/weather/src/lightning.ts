import { randomBetween } from '@elementalfx/core';
import { Kind, type SpriteBatch } from './particles';

interface Bolt {
  /** x1, y1, x2, y2, width per segment. */
  segments: number[];
  age: number;
  life: number;
}

interface Pulse {
  at: number;
  strength: number;
}

/** WCAG 2.3.1: never more than three flashes in any one second. */
const MAX_FLASHES_PER_SECOND = 3;
const MIN_GAP = 2.5; // seconds between automatic strikes

/** Branching lightning bolts plus a rate-limited sky flash. */
export class Lightning {
  /** Current flash brightness, 0 to 1. */
  flash = 0;
  private bolts: Bolt[] = [];
  private pulses: Pulse[] = [];
  private flashTimes: number[] = [];
  private time = 0;
  private wait = 2 + Math.random() * 4;

  get active(): boolean {
    return this.bolts.length > 0 || this.flash > 0.002;
  }

  update(
    dt: number,
    width: number,
    height: number,
    random: () => number,
    auto: { enabled: boolean; rate: number; flash: number },
  ): void {
    this.time += dt;
    if (auto.enabled && auto.rate > 0) {
      this.wait -= dt;
      if (this.wait <= 0) {
        this.strike(width, height, random, auto.flash);
        // Exponential gaps feel natural; the minimum keeps storms from strobing.
        const mean = 60 / auto.rate;
        this.wait = Math.max(MIN_GAP, -Math.log(1 - random()) * mean);
      }
    }
    for (const bolt of this.bolts) bolt.age += dt;
    this.bolts = this.bolts.filter((bolt) => bolt.age < bolt.life);
    this.pulses = this.pulses.filter((pulse) => this.time - pulse.at < 0.6);
    let flash = 0;
    for (const pulse of this.pulses) {
      const t = this.time - pulse.at;
      if (t >= 0) flash = Math.max(flash, pulse.strength * Math.exp(-t / 0.09));
    }
    this.flash = flash;
  }

  /** Starts a strike now. `x` defaults to a random spot across the top. */
  strike(width: number, height: number, random: () => number, flashStrength: number, x?: number): void {
    const startX = x ?? randomBetween(random, width * 0.1, width * 0.9);
    const endX = startX + randomBetween(random, -0.2, 0.2) * width;
    const endY = randomBetween(random, 0.45, 0.85) * height;
    const segments: number[] = [];
    const path = displace([startX, -10, endX, endY], 6, 0.2, random);
    addPath(segments, path, 2.2);
    const branches = 1 + Math.floor(random() * 3);
    for (let b = 0; b < branches; b++) {
      const at = 2 * Math.floor(randomBetween(random, 0.2, 0.7) * (path.length / 2));
      const bx = path[at]!;
      const by = path[at + 1]!;
      const length = randomBetween(random, 0.12, 0.28) * height;
      const angle = randomBetween(random, 0.35, 1.1) * (random() < 0.5 ? -1 : 1);
      const branch = displace([bx, by, bx + Math.sin(angle) * length, by + Math.cos(angle) * length], 4, 0.25, random);
      addPath(segments, branch, 1.1);
    }
    this.bolts.push({ segments, age: 0, life: 0.38 });
    this.addPulse(this.time, flashStrength);
    this.addPulse(this.time + randomBetween(random, 0.07, 0.14), flashStrength * 0.6);
  }

  private addPulse(at: number, strength: number): void {
    if (strength <= 0) return;
    this.flashTimes = this.flashTimes.filter((t) => at - t < 1);
    if (this.flashTimes.length >= MAX_FLASHES_PER_SECOND) return;
    this.flashTimes.push(at);
    this.pulses.push({ at, strength });
  }

  draw(batch: SpriteBatch, color: [number, number, number]): void {
    const [r, g, b] = color;
    for (const bolt of this.bolts) {
      const t = bolt.age / bolt.life;
      const flicker = bolt.age < 0.05 ? 1 : 0.7 + 0.3 * Math.sin(bolt.age * 90);
      const alpha = (1 - t) * flicker;
      const s = bolt.segments;
      for (let i = 0; i < s.length; i += 5) {
        const x1 = s[i]!;
        const y1 = s[i + 1]!;
        const x2 = s[i + 2]!;
        const y2 = s[i + 3]!;
        const w = s[i + 4]!;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.hypot(dx, dy);
        batch.push((x1 + x2) / 2, (y1 + y2) / 2, w * 8, length + w, -Math.atan2(dx, dy), alpha, Kind.Bolt, r, g, b);
      }
    }
  }

  /** Raw segments for the 2D renderer: x1, y1, x2, y2, width, alpha. */
  lines(): number[] {
    const out: number[] = [];
    for (const bolt of this.bolts) {
      const alpha = 1 - bolt.age / bolt.life;
      const s = bolt.segments;
      for (let i = 0; i < s.length; i += 5) out.push(s[i]!, s[i + 1]!, s[i + 2]!, s[i + 3]!, s[i + 4]!, alpha);
    }
    return out;
  }
}

/** Midpoint displacement: subdivides a segment, nudging midpoints sideways. Returns x,y pairs. */
function displace(path: number[], depth: number, roughness: number, random: () => number): number[] {
  let points = path;
  for (let level = 0; level < depth; level++) {
    const next: number[] = [];
    for (let i = 0; i < points.length - 2; i += 2) {
      const x1 = points[i]!;
      const y1 = points[i + 1]!;
      const x2 = points[i + 2]!;
      const y2 = points[i + 3]!;
      const length = Math.hypot(x2 - x1, y2 - y1);
      const offset = (random() - 0.5) * length * roughness * 2;
      const nx = -(y2 - y1) / (length || 1);
      const ny = (x2 - x1) / (length || 1);
      next.push(x1, y1, (x1 + x2) / 2 + nx * offset, (y1 + y2) / 2 + ny * offset);
    }
    next.push(points[points.length - 2]!, points[points.length - 1]!);
    points = next;
  }
  return points;
}

function addPath(out: number[], points: number[], width: number): void {
  const count = points.length / 2 - 1;
  for (let i = 0; i < count; i++) {
    // Bolts thin toward their tips.
    const w = width * (1 - (i / count) * 0.55);
    out.push(points[i * 2]!, points[i * 2 + 1]!, points[i * 2 + 2]!, points[i * 2 + 3]!, w);
  }
}
