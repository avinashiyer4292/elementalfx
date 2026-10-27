const BIN = 4; // CSS px per height cell
const MAX_SURFACES = 32;
const MAX_SLOPE = 1.25; // px of height difference allowed between neighbouring cells
const REQUERY_MS = 1000;

interface Surface {
  element: Element;
  heights: Float32Array;
  left: number;
  top: number;
  width: number;
  visible: boolean;
  radiusLeft: number;
  radiusRight: number;
}

/**
 * Page elements whose top edges catch snow and rain. Snow piles up in a
 * height map per element (4 px cells), slumps when too steep, melts when
 * the snow stops, and moves with the element as the page scrolls.
 */
export class Surfaces {
  private surfaces: Surface[] = [];
  private source: string | Element[] | null = null;
  private lastQuery = -Infinity;

  constructor(private readonly root: ParentNode) {}

  setSource(source: string | Element[] | null): void {
    this.source = source;
    this.lastQuery = -Infinity;
  }

  get count(): number {
    return this.surfaces.length;
  }

  /** Total snow held, in px² (used by tests and for idle detection). */
  get snow(): number {
    let total = 0;
    for (const surface of this.surfaces) for (const h of surface.heights) total += h * BIN;
    return total;
  }

  /** Re-measures every surface relative to the canvas origin (in client coordinates). */
  measure(originLeft: number, originTop: number, now: number): void {
    if (!this.source) {
      this.surfaces = [];
      return;
    }
    if (now - this.lastQuery > REQUERY_MS) this.query();
    for (const surface of this.surfaces) {
      const rect = surface.element.getBoundingClientRect();
      surface.visible = rect.width > 0 && rect.height > 0 && surface.element.isConnected;
      surface.left = rect.left - originLeft;
      surface.top = rect.top - originTop;
      if (Math.abs(rect.width - surface.width) > 0.5) {
        surface.heights = resample(surface.heights, Math.max(1, Math.ceil(rect.width / BIN)));
        surface.width = rect.width;
      }
    }
  }

  private query(): void {
    this.lastQuery = performance.now();
    const elements =
      typeof this.source === 'string'
        ? Array.from((this.root as ParentNode).querySelectorAll(this.source))
        : (this.source ?? []);
    const next: Surface[] = [];
    for (const element of elements.slice(0, MAX_SURFACES)) {
      const existing = this.surfaces.find((s) => s.element === element);
      const style = getComputedStyle(element);
      const radiusLeft = parseFloat(style.borderTopLeftRadius) || 0;
      const radiusRight = parseFloat(style.borderTopRightRadius) || 0;
      if (existing) {
        existing.radiusLeft = radiusLeft;
        existing.radiusRight = radiusRight;
        next.push(existing);
      } else {
        next.push({ element, heights: new Float32Array(0), left: 0, top: 0, width: 0, visible: false, radiusLeft, radiusRight });
      }
    }
    this.surfaces = next;
  }

  /** If a particle moving from prevY to y at x crosses a surface (or the snow on it), returns that y. */
  hit(x: number, prevY: number, y: number): number | null {
    for (const s of this.surfaces) {
      if (!s.visible || x < s.left || x >= s.left + s.width) continue;
      const cell = Math.floor((x - s.left) / BIN);
      const top = s.top - (s.heights[cell] ?? 0);
      if (prevY <= top && y >= top) return top;
    }
    return null;
  }

  /** Adds snow at x on the surface whose top is at y, spread over three cells. */
  deposit(x: number, y: number, amount: number, maxDepth: number): void {
    for (const s of this.surfaces) {
      if (!s.visible || x < s.left || x >= s.left + s.width) continue;
      const cell = Math.floor((x - s.left) / BIN);
      if (Math.abs(s.top - (s.heights[cell] ?? 0) - y) > 1) continue;
      const n = s.heights.length;
      const add = (i: number, share: number): void => {
        if (i < 0 || i >= n) return;
        const limit = this.limit(s, i, maxDepth);
        s.heights[i] = Math.min(limit, s.heights[i]! + amount * share);
      };
      add(cell, 0.5);
      add(cell - 1, 0.25);
      add(cell + 1, 0.25);
      return;
    }
  }

  /** Slumps steep spots and melts snow. `melt` is in px per second. */
  update(dt: number, melt: number, maxDepth: number): void {
    for (const s of this.surfaces) {
      const h = s.heights;
      for (let i = 0; i < h.length - 1; i++) {
        const diff = h[i]! - h[i + 1]!;
        if (Math.abs(diff) <= MAX_SLOPE) continue;
        const move = (Math.abs(diff) - MAX_SLOPE) * 0.5;
        if (diff > 0) {
          h[i] = h[i]! - move;
          h[i + 1] = h[i + 1]! + move;
        } else {
          h[i] = h[i]! + move;
          h[i + 1] = h[i + 1]! - move;
        }
      }
      // Snow slides off the ends.
      if (h.length > 0) {
        h[0] = Math.min(h[0]!, this.limit(s, 0, maxDepth));
        h[h.length - 1] = Math.min(h[h.length - 1]!, this.limit(s, h.length - 1, maxDepth));
      }
      if (melt > 0) for (let i = 0; i < h.length; i++) h[i] = Math.max(0, h[i]! - melt * dt);
    }
  }

  clear(): void {
    for (const s of this.surfaces) s.heights.fill(0);
  }

  /**
   * Builds triangles for every snow cap: a solid body plus a 1.5 px feathered
   * top edge. Vertices are (x, y, alpha) triples; returns the vertex count.
   */
  build(out: { data: Float32Array }): number {
    let count = 0;
    const push = (x: number, y: number, a: number): void => {
      if ((count + 1) * 3 > out.data.length) {
        const grown = new Float32Array(out.data.length * 2 + 3072);
        grown.set(out.data);
        out.data = grown;
      }
      out.data[count * 3] = x;
      out.data[count * 3 + 1] = y;
      out.data[count * 3 + 2] = a;
      count++;
    };
    for (const s of this.surfaces) {
      if (!s.visible) continue;
      const points = this.profile(s);
      if (!points) continue;
      const base = s.top + 1;
      for (let i = 0; i < points.length - 2; i += 2) {
        const x0 = points[i]!;
        const y0 = points[i + 1]!;
        const x1 = points[i + 2]!;
        const y1 = points[i + 3]!;
        if (y0 >= base - 0.05 && y1 >= base - 0.05) continue;
        // Body.
        push(x0, base, 1); push(x1, base, 1); push(x0, y0, 1);
        push(x1, base, 1); push(x1, y1, 1); push(x0, y0, 1);
        // Feather.
        push(x0, y0, 1); push(x1, y1, 1); push(x0, y0 - 1.5, 0);
        push(x1, y1, 1); push(x1, y1 - 1.5, 0); push(x0, y0 - 1.5, 0);
      }
    }
    return count;
  }

  /** Smoothed cap outline for one surface as x,y pairs, or null if there is no snow. */
  private profile(s: Surface): number[] | null {
    const h = s.heights;
    let any = false;
    for (const value of h) if (value > 0.15) any = true;
    if (!any) return null;
    const points: number[] = [];
    for (let i = 0; i <= h.length; i++) {
      const a = h[Math.max(0, i - 1)] ?? 0;
      const b = h[Math.min(h.length - 1, i)] ?? 0;
      const height = i === 0 || i === h.length ? Math.min(a, b) * 0.5 : (a + b) * 0.5;
      points.push(s.left + Math.min(s.width, i * BIN), s.top - height);
    }
    return points;
  }

  /** Draws caps on a 2D canvas (fallback renderer). */
  draw2D(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(250, 252, 255, 0.97)';
    for (const s of this.surfaces) {
      if (!s.visible) continue;
      const points = this.profile(s);
      if (!points) continue;
      ctx.beginPath();
      ctx.moveTo(s.left, s.top + 1);
      for (let i = 0; i < points.length; i += 2) ctx.lineTo(points[i]!, points[i + 1]!);
      ctx.lineTo(s.left + s.width, s.top + 1);
      ctx.closePath();
      ctx.fill();
    }
  }

  /** Tallest snow allowed at a cell: tapered near rounded corners and the ends. */
  private limit(s: Surface, cell: number, maxDepth: number): number {
    const x = cell * BIN + BIN / 2;
    const fromLeft = x / (s.radiusLeft + 6);
    const fromRight = (s.width - x) / (s.radiusRight + 6);
    return maxDepth * Math.max(0, Math.min(1, fromLeft, fromRight));
  }
}

function resample(heights: Float32Array, length: number): Float32Array {
  const next = new Float32Array(length);
  if (heights.length === 0) return next;
  for (let i = 0; i < length; i++) {
    next[i] = heights[Math.min(heights.length - 1, Math.floor((i / length) * heights.length))]!;
  }
  return next;
}
