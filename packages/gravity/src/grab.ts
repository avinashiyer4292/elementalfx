import type { Body } from './body';

/**
 * A soft spring pulling a point on a body toward a target, used for dragging
 * with the pointer (after Box2D's mouse joint). The body keeps its momentum
 * when released, so a quick flick throws it.
 */
export class Grab {
  targetX: number;
  targetY: number;
  private localX: number;
  private localY: number;
  private ix = 0;
  private iy = 0;
  private rx = 0;
  private ry = 0;
  private m11 = 0;
  private m12 = 0;
  private m22 = 0;
  private cx = 0;
  private cy = 0;
  private gamma = 0;
  private maxImpulse = 0;

  constructor(
    readonly body: Body,
    x: number,
    y: number,
    /** Spring frequency in Hz. */
    readonly frequency = 6,
    readonly damping = 0.8,
  ) {
    const c = Math.cos(body.angle);
    const s = Math.sin(body.angle);
    const dx = x - body.x;
    const dy = y - body.y;
    this.localX = c * dx + s * dy;
    this.localY = -s * dx + c * dy;
    this.targetX = x;
    this.targetY = y;
  }

  moveTo(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
    this.body.wake();
  }

  /** @internal */
  prepare(dt: number): void {
    const b = this.body;
    const c = Math.cos(b.angle);
    const s = Math.sin(b.angle);
    this.rx = c * this.localX - s * this.localY;
    this.ry = s * this.localX + c * this.localY;
    const omega = 2 * Math.PI * this.frequency;
    const d = 2 * b.mass * this.damping * omega;
    const k = b.mass * omega * omega;
    this.gamma = 1 / (dt * (d + dt * k));
    const beta = dt * k * this.gamma;
    const im = b.invMass;
    const ii = b.invInertia;
    const k11 = im + ii * this.ry * this.ry + this.gamma;
    const k12 = -ii * this.rx * this.ry;
    const k22 = im + ii * this.rx * this.rx + this.gamma;
    const det = k11 * k22 - k12 * k12;
    const inv = det !== 0 ? 1 / det : 0;
    this.m11 = inv * k22;
    this.m12 = -inv * k12;
    this.m22 = inv * k11;
    this.cx = (b.x + this.rx - this.targetX) * beta;
    this.cy = (b.y + this.ry - this.targetY) * beta;
    this.maxImpulse = b.mass * 40000 * dt;
    // Damp spin a little so a held body settles under the pointer.
    b.w *= 0.98;
    this.apply(this.ix, this.iy);
  }

  /** @internal */
  solve(): void {
    const b = this.body;
    const vx = b.vx - b.w * this.ry;
    const vy = b.vy + b.w * this.rx;
    const ex = -(vx + this.cx + this.gamma * this.ix);
    const ey = -(vy + this.cy + this.gamma * this.iy);
    let dx = this.m11 * ex + this.m12 * ey;
    let dy = this.m12 * ex + this.m22 * ey;
    const ox = this.ix;
    const oy = this.iy;
    this.ix += dx;
    this.iy += dy;
    const length = Math.hypot(this.ix, this.iy);
    if (length > this.maxImpulse) {
      this.ix *= this.maxImpulse / length;
      this.iy *= this.maxImpulse / length;
    }
    dx = this.ix - ox;
    dy = this.iy - oy;
    this.apply(dx, dy);
  }

  private apply(px: number, py: number): void {
    const b = this.body;
    b.vx += b.invMass * px;
    b.vy += b.invMass * py;
    b.w += b.invInertia * (this.rx * py - this.ry * px);
  }
}
