/**
 * A rigid box or circle in CSS px, radians and seconds. y points down, like
 * the page, so positive angles turn clockwise on screen.
 */
export interface BodyOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  shape?: 'box' | 'circle';
  angle?: number;
  /** Mass per CSS px² of area. Default 1. 0 makes the body static. */
  density?: number;
  friction?: number;
  restitution?: number;
}

export class Body {
  static nextId = 1;
  readonly id = Body.nextId++;
  x: number;
  y: number;
  angle: number;
  vx = 0;
  vy = 0;
  w = 0;
  readonly shape: 'box' | 'circle';
  readonly hw: number;
  readonly hh: number;
  readonly radius: number;
  readonly invMass: number;
  readonly invInertia: number;
  readonly mass: number;
  friction: number;
  restitution: number;
  sleeping = false;
  sleepTime = 0;
  /** Arbitrary data, e.g. the DOM element this body moves. */
  data: unknown = null;

  constructor(options: BodyOptions) {
    this.x = options.x;
    this.y = options.y;
    this.angle = options.angle ?? 0;
    this.shape = options.shape ?? 'box';
    this.hw = options.width / 2;
    this.hh = options.height / 2;
    this.radius = Math.min(this.hw, this.hh);
    this.friction = options.friction ?? 0.5;
    this.restitution = options.restitution ?? 0.2;
    const density = options.density ?? 1;
    if (density <= 0) {
      this.mass = Infinity;
      this.invMass = 0;
      this.invInertia = 0;
    } else if (this.shape === 'circle') {
      this.mass = Math.PI * this.radius * this.radius * density;
      this.invMass = 1 / this.mass;
      this.invInertia = 1 / (0.5 * this.mass * this.radius * this.radius);
    } else {
      this.mass = 4 * this.hw * this.hh * density;
      this.invMass = 1 / this.mass;
      this.invInertia = 1 / ((this.mass * (4 * this.hw * this.hw + 4 * this.hh * this.hh)) / 12);
    }
  }

  get isStatic(): boolean {
    return this.invMass === 0;
  }

  wake(): void {
    this.sleeping = false;
    this.sleepTime = 0;
  }

  /** Axis-aligned bounds: [minX, minY, maxX, maxY]. */
  bounds(): [number, number, number, number] {
    if (this.shape === 'circle') {
      return [this.x - this.radius, this.y - this.radius, this.x + this.radius, this.y + this.radius];
    }
    const c = Math.abs(Math.cos(this.angle));
    const s = Math.abs(Math.sin(this.angle));
    const ex = this.hw * c + this.hh * s;
    const ey = this.hw * s + this.hh * c;
    return [this.x - ex, this.y - ey, this.x + ex, this.y + ey];
  }

  /** Applies an impulse (px·mass/s) at a world point. */
  applyImpulse(px: number, py: number, atX = this.x, atY = this.y): void {
    if (this.isStatic) return;
    this.wake();
    this.vx += px * this.invMass;
    this.vy += py * this.invMass;
    this.w += this.invInertia * ((atX - this.x) * py - (atY - this.y) * px);
  }
}
