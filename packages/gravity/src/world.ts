/**
 * A compact 2D rigid-body engine for boxes and circles, in CSS px and seconds.
 * Box-box contacts use separating axes and edge clipping, and the solver uses
 * sequential impulses with warm starting (after Erin Catto's Box2D Lite).
 * Bodies that come to rest fall asleep and cost nothing until disturbed.
 */


import type { Body } from './body';
import { collide, type Contact } from './collide';
import { Grab } from './grab';

class Arbiter {
  contacts: Contact[] = [];
  friction: number;
  restitution: number;

  constructor(
    readonly a: Body,
    readonly b: Body,
  ) {
    this.friction = Math.sqrt(a.friction * b.friction);
    this.restitution = Math.max(a.restitution, b.restitution);
  }

  /** Replaces contacts, keeping accumulated impulses for matching features (warm starting). */
  update(next: Contact[]): void {
    for (const contact of next) {
      const previous = this.contacts.find((c) => c.feature === contact.feature);
      if (previous) {
        contact.pn = previous.pn;
        contact.pt = previous.pt;
      }
    }
    this.contacts = next;
  }
}

export interface WorldOptions {
  /** Downward acceleration in px/s². Default 2000. */
  gravity?: number;
  /** Solver iterations per substep. Default 6. */
  iterations?: number;
  /**
   * Fixed simulation rate in steps per second. `step(dt)` runs as many fixed
   * substeps as fit in `dt`. Stacks of boxes only stand reliably at around
   * 240 Hz with a sequential-impulse solver, so that is the default.
   */
  rate?: number;
}

const ALLOWED_PENETRATION = 0.75;
const BIAS_FACTOR = 0.2;
// Only real impacts bounce; resting contacts don't.
const RESTITUTION_THRESHOLD = 60; // px/s
// Bodies touching each other sleep as a group (an island) once every point on
// every one of them has moved slower than this for SLEEP_TIME.
const SLEEP_SPEED = 6; // px/s
const SLEEP_TIME = 0.5; // s
// Longest stretch simulated per call, so a stalled tab doesn't spiral.
const MAX_FRAME = 1 / 15; // s
// Fast throws are capped so bodies can't tunnel through each other between substeps.
const MAX_SPEED = 5000; // px/s

export class World {
  bodies: Body[] = [];
  gravity: number;
  iterations: number;
  rate: number;
  private arbiters = new Map<string, Arbiter>();
  private grabs: Grab[] = [];
  private pending = 0;

  constructor(options: WorldOptions = {}) {
    this.gravity = options.gravity ?? 2000;
    this.iterations = options.iterations ?? 6;
    this.rate = options.rate ?? 240;
  }

  add(body: Body): Body {
    this.bodies.push(body);
    return body;
  }

  remove(body: Body): void {
    this.bodies = this.bodies.filter((b) => b !== body);
    this.grabs = this.grabs.filter((g) => g.body !== body);
    // Whatever rested on it has to fall now.
    this.wakeTouching(body);
    for (const [key, arbiter] of this.arbiters) {
      if (arbiter.a === body || arbiter.b === body) this.arbiters.delete(key);
    }
  }

  clear(): void {
    this.bodies = [];
    this.grabs = [];
    this.arbiters.clear();
  }

  /** Start dragging `body` by the world point (x, y). Move it with `grab.moveTo`. */
  grab(body: Body, x: number, y: number): Grab {
    const grab = new Grab(body, x, y);
    this.grabs.push(grab);
    this.wakeTouching(body);
    body.wake();
    return grab;
  }

  release(grab: Grab): void {
    this.grabs = this.grabs.filter((g) => g !== grab);
  }

  /**
   * Wake every body touching `body`, e.g. before pulling it out of a pile.
   * Goes by bounds rather than contacts, since two sleeping bodies keep none.
   */
  wakeTouching(body: Body): void {
    const [x0, y0, x1, y1] = body.bounds();
    const slack = 2;
    for (const other of this.bodies) {
      if (other === body || !other.sleeping) continue;
      const [u0, v0, u1, v1] = other.bounds();
      if (u0 <= x1 + slack && u1 >= x0 - slack && v0 <= y1 + slack && v1 >= y0 - slack) other.wake();
    }
  }

  /** Put every body to sleep at once, as one island, e.g. to stop a pile that keeps fidgeting. */
  sleepAll(): void {
    const island = this.bodies.filter((b) => !b.isStatic && this.grabs.every((g) => g.body !== b));
    for (const b of island) {
      b.sleeping = true;
      b.island = island;
      b.vx = b.vy = b.w = 0;
    }
  }

  /** True when every dynamic body is asleep. */
  get settled(): boolean {
    return this.bodies.every((b) => b.isStatic || b.sleeping);
  }

  /** Advance by `dt` seconds in fixed substeps. Returns the number of substeps run. */
  step(dt: number): number {
    if (!(dt > 0)) return 0;
    const h = 1 / this.rate;
    this.pending = Math.min(this.pending + dt, MAX_FRAME);
    let count = 0;
    // The small tolerance keeps dt = 1/rate from occasionally running zero substeps.
    while (this.pending >= h * 0.999) {
      this.substep(h);
      this.pending = Math.max(0, this.pending - h);
      count++;
    }
    return count;
  }

  private substep(dt: number): void {
    const invDt = 1 / dt;
    this.broadphase();

    for (const b of this.bodies) {
      if (b.isStatic || b.sleeping) continue;
      b.vy += this.gravity * dt;
      // A touch of air drag keeps throws from flying forever.
      const drag = 1 / (1 + dt * 0.05);
      b.vx *= drag;
      b.vy *= drag;
      b.w *= 1 / (1 + dt * 0.4);
    }

    // Measure approach speeds for every contact before any warm starting changes them.
    for (const arbiter of this.arbiters.values()) this.preStep(arbiter, invDt);
    for (const arbiter of this.arbiters.values()) this.warmStart(arbiter);
    for (const grab of this.grabs) grab.prepare(dt);
    for (let i = 0; i < this.iterations; i++) {
      for (const grab of this.grabs) grab.solve();
      for (const arbiter of this.arbiters.values()) this.applyImpulses(arbiter);
    }

    for (const b of this.bodies) {
      if (b.isStatic || b.sleeping) continue;
      const speed = Math.hypot(b.vx, b.vy);
      if (speed > MAX_SPEED) {
        b.vx *= MAX_SPEED / speed;
        b.vy *= MAX_SPEED / speed;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.angle += b.w * dt;
      const edge = Math.abs(b.w) * Math.hypot(b.hw, b.hh);
      const still = Math.hypot(b.vx, b.vy) + edge < SLEEP_SPEED;
      b.sleepTime = still ? b.sleepTime + dt : 0;
    }
    // A held body never sleeps.
    for (const grab of this.grabs) grab.body.sleepTime = 0;
    this.sleepIslands();
  }

  /**
   * Groups awake bodies that touch into islands and puts an island to sleep
   * once all of it has been still for SLEEP_TIME. A body resting on another
   * can't sleep alone, so nothing is ever pinned under a sleeping neighbour.
   */
  private sleepIslands(): void {
    const find = (body: Body): Body => {
      while (body.root !== body) {
        body.root = body.root.root;
        body = body.root;
      }
      return body;
    };
    const awake = this.bodies.filter((b) => !b.isStatic && !b.sleeping);
    for (const b of awake) b.root = b;
    for (const { a, b } of this.arbiters.values()) {
      if (a.isStatic || b.isStatic || a.sleeping || b.sleeping) continue;
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) ra.root = rb;
    }
    const islands = new Map<Body, Body[]>();
    const restless = new Set<Body>();
    for (const b of awake) {
      const root = find(b);
      let island = islands.get(root);
      if (!island) islands.set(root, (island = []));
      island.push(b);
      if (b.sleepTime < SLEEP_TIME) restless.add(root);
    }
    for (const [root, island] of islands) {
      if (restless.has(root)) continue;
      for (const b of island) {
        b.sleeping = true;
        b.island = island;
        b.vx = b.vy = b.w = 0;
      }
    }
  }

  /** Sort-and-sweep on x to find overlapping pairs, then narrow-phase contacts. */
  private broadphase(): void {
    const entries = this.bodies.map((body) => ({ body, box: body.bounds() }));
    entries.sort((p, q) => p.box[0] - q.box[0]);
    const seen = new Set<string>();
    for (let i = 0; i < entries.length; i++) {
      const p = entries[i]!;
      for (let j = i + 1; j < entries.length; j++) {
        const q = entries[j]!;
        if (q.box[0] > p.box[2]) break;
        if (q.box[1] > p.box[3] || q.box[3] < p.box[1]) continue;
        let a = p.body;
        let b = q.body;
        if ((a.isStatic || a.sleeping) && (b.isStatic || b.sleeping)) continue;
        if (a.id > b.id) [a, b] = [b, a];
        const key = `${a.id}:${b.id}`;
        const contacts = collide(a, b);
        if (contacts.length === 0) continue;
        // Touching an awake body wakes a sleeping one, and its whole island.
        if (a.sleeping && !b.isStatic) a.wake();
        if (b.sleeping && !a.isStatic) b.wake();
        seen.add(key);
        let arbiter = this.arbiters.get(key);
        if (!arbiter) {
          arbiter = new Arbiter(a, b);
          this.arbiters.set(key, arbiter);
        }
        arbiter.update(contacts);
      }
    }
    for (const key of this.arbiters.keys()) if (!seen.has(key)) this.arbiters.delete(key);
  }

  private preStep(arbiter: Arbiter, invDt: number): void {
    const { a, b } = arbiter;
    const ima = a.sleeping ? 0 : a.invMass;
    const imb = b.sleeping ? 0 : b.invMass;
    const iia = a.sleeping ? 0 : a.invInertia;
    const iib = b.sleeping ? 0 : b.invInertia;
    for (const c of arbiter.contacts) {
      const r1x = c.x - a.x;
      const r1y = c.y - a.y;
      const r2x = c.x - b.x;
      const r2y = c.y - b.y;
      const rn1 = r1x * c.nx + r1y * c.ny;
      const rn2 = r2x * c.nx + r2y * c.ny;
      const kNormal = ima + imb + iia * (r1x * r1x + r1y * r1y - rn1 * rn1) + iib * (r2x * r2x + r2y * r2y - rn2 * rn2);
      c.massNormal = kNormal > 0 ? 1 / kNormal : 0;
      const tx = c.ny;
      const ty = -c.nx;
      const rt1 = r1x * tx + r1y * ty;
      const rt2 = r2x * tx + r2y * ty;
      const kTangent = ima + imb + iia * (r1x * r1x + r1y * r1y - rt1 * rt1) + iib * (r2x * r2x + r2y * r2y - rt2 * rt2);
      c.massTangent = kTangent > 0 ? 1 / kTangent : 0;
      c.bias = -BIAS_FACTOR * invDt * Math.min(0, c.separation + ALLOWED_PENETRATION);
      // Bounce: aim for a rebound proportional to the approach speed.
      const dvx = b.vx - b.w * r2y - a.vx + a.w * r1y;
      const dvy = b.vy + b.w * r2x - a.vy - a.w * r1x;
      const vn = dvx * c.nx + dvy * c.ny;
      if (vn < -RESTITUTION_THRESHOLD) c.bias = Math.max(c.bias, -arbiter.restitution * vn);
    }
  }

  /** Re-apply last step's impulses so the solver starts close to the answer. */
  private warmStart(arbiter: Arbiter): void {
    const { a, b } = arbiter;
    const ima = a.sleeping ? 0 : a.invMass;
    const imb = b.sleeping ? 0 : b.invMass;
    const iia = a.sleeping ? 0 : a.invInertia;
    const iib = b.sleeping ? 0 : b.invInertia;
    for (const c of arbiter.contacts) {
      const r1x = c.x - a.x;
      const r1y = c.y - a.y;
      const r2x = c.x - b.x;
      const r2y = c.y - b.y;
      const tx = c.ny;
      const ty = -c.nx;
      const px = c.pn * c.nx + c.pt * tx;
      const py = c.pn * c.ny + c.pt * ty;
      a.vx -= ima * px;
      a.vy -= ima * py;
      a.w -= iia * (r1x * py - r1y * px);
      b.vx += imb * px;
      b.vy += imb * py;
      b.w += iib * (r2x * py - r2y * px);
    }
  }

  private applyImpulses(arbiter: Arbiter): void {
    const { a, b } = arbiter;
    const ima = a.sleeping ? 0 : a.invMass;
    const imb = b.sleeping ? 0 : b.invMass;
    const iia = a.sleeping ? 0 : a.invInertia;
    const iib = b.sleeping ? 0 : b.invInertia;
    for (const c of arbiter.contacts) {
      const r1x = c.x - a.x;
      const r1y = c.y - a.y;
      const r2x = c.x - b.x;
      const r2y = c.y - b.y;

      let dvx = b.vx - b.w * r2y - a.vx + a.w * r1y;
      let dvy = b.vy + b.w * r2x - a.vy - a.w * r1x;
      const vn = dvx * c.nx + dvy * c.ny;
      let dPn = c.massNormal * (-vn + c.bias);
      const pn0 = c.pn;
      c.pn = Math.max(pn0 + dPn, 0);
      dPn = c.pn - pn0;
      let px = dPn * c.nx;
      let py = dPn * c.ny;
      a.vx -= ima * px;
      a.vy -= ima * py;
      a.w -= iia * (r1x * py - r1y * px);
      b.vx += imb * px;
      b.vy += imb * py;
      b.w += iib * (r2x * py - r2y * px);

      dvx = b.vx - b.w * r2y - a.vx + a.w * r1y;
      dvy = b.vy + b.w * r2x - a.vy - a.w * r1x;
      const tx = c.ny;
      const ty = -c.nx;
      const vt = dvx * tx + dvy * ty;
      let dPt = c.massTangent * -vt;
      const maxPt = arbiter.friction * c.pn;
      const pt0 = c.pt;
      c.pt = Math.max(-maxPt, Math.min(maxPt, pt0 + dPt));
      dPt = c.pt - pt0;
      px = dPt * tx;
      py = dPt * ty;
      a.vx -= ima * px;
      a.vy -= ima * py;
      a.w -= iia * (r1x * py - r1y * px);
      b.vx += imb * px;
      b.vy += imb * py;
      b.w += iib * (r2x * py - r2y * px);
    }
  }
}
