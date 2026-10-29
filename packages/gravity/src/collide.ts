import type { Body } from './body';

/** A contact point between two bodies, with the normal pointing from A to B. */
export interface Contact {
  x: number;
  y: number;
  nx: number;
  ny: number;
  separation: number;
  feature: number;
  pn: number;
  pt: number;
  massNormal: number;
  massTangent: number;
  bias: number;
}

const EDGE1 = 1;
const EDGE2 = 2;
const EDGE3 = 3;
const EDGE4 = 4;

interface ClipVertex {
  x: number;
  y: number;
  in1: number;
  out1: number;
  in2: number;
  out2: number;
}

const feature = (v: ClipVertex): number => v.in1 | (v.out1 << 4) | (v.in2 << 8) | (v.out2 << 12);
const flippedFeature = (v: ClipVertex): number => v.in2 | (v.out2 << 4) | (v.in1 << 8) | (v.out1 << 12);

function clipSegment(input: ClipVertex[], nx: number, ny: number, offset: number, clipEdge: number): ClipVertex[] {
  const out: ClipVertex[] = [];
  const [v0, v1] = input as [ClipVertex, ClipVertex];
  const d0 = nx * v0.x + ny * v0.y - offset;
  const d1 = nx * v1.x + ny * v1.y - offset;
  if (d0 <= 0) out.push(v0);
  if (d1 <= 0) out.push(v1);
  if (d0 * d1 < 0) {
    const t = d0 / (d0 - d1);
    const x = v0.x + t * (v1.x - v0.x);
    const y = v0.y + t * (v1.y - v0.y);
    if (d0 > 0) out.push({ ...v0, x, y, in1: clipEdge, in2: 0 });
    else out.push({ ...v1, x, y, out1: clipEdge, out2: 0 });
  }
  return out;
}

/** The incident edge of box (pos, rot, h) for a reference face normal (world space). */
function incidentEdge(hx: number, hy: number, px: number, py: number, c: number, s: number, nx: number, ny: number): ClipVertex[] {
  // Normal in the incident box's frame, flipped.
  const lx = -(c * nx + s * ny);
  const ly = -(-s * nx + c * ny);
  let v: ClipVertex[];
  if (Math.abs(lx) > Math.abs(ly)) {
    v =
      lx > 0
        ? [
            { x: hx, y: -hy, in1: 0, out1: 0, in2: EDGE3, out2: EDGE4 },
            { x: hx, y: hy, in1: 0, out1: 0, in2: EDGE4, out2: EDGE1 },
          ]
        : [
            { x: -hx, y: hy, in1: 0, out1: 0, in2: EDGE1, out2: EDGE2 },
            { x: -hx, y: -hy, in1: 0, out1: 0, in2: EDGE2, out2: EDGE3 },
          ];
  } else {
    v =
      ly > 0
        ? [
            { x: hx, y: hy, in1: 0, out1: 0, in2: EDGE4, out2: EDGE1 },
            { x: -hx, y: hy, in1: 0, out1: 0, in2: EDGE1, out2: EDGE2 },
          ]
        : [
            { x: -hx, y: -hy, in1: 0, out1: 0, in2: EDGE2, out2: EDGE3 },
            { x: hx, y: -hy, in1: 0, out1: 0, in2: EDGE3, out2: EDGE4 },
          ];
  }
  for (const p of v) {
    const x = px + c * p.x - s * p.y;
    const y = py + s * p.x + c * p.y;
    p.x = x;
    p.y = y;
  }
  return v;
}

function contact(x: number, y: number, nx: number, ny: number, separation: number, feature: number): Contact {
  return { x, y, nx, ny, separation, feature, pn: 0, pt: 0, massNormal: 0, massTangent: 0, bias: 0 };
}

/** Box-box contacts with the normal pointing from A to B. */
function collideBoxes(A: Body, B: Body): Contact[] {
  const ca = Math.cos(A.angle);
  const sa = Math.sin(A.angle);
  const cb = Math.cos(B.angle);
  const sb = Math.sin(B.angle);
  const dpx = B.x - A.x;
  const dpy = B.y - A.y;
  // dA = RotA^T * dp, dB = RotB^T * dp
  const dAx = ca * dpx + sa * dpy;
  const dAy = -sa * dpx + ca * dpy;
  const dBx = cb * dpx + sb * dpy;
  const dBy = -sb * dpx + cb * dpy;
  // C = RotA^T * RotB
  const c11 = ca * cb + sa * sb;
  const c12 = -ca * sb + sa * cb;
  const c21 = -sa * cb + ca * sb;
  const c22 = sa * sb + ca * cb;
  const a11 = Math.abs(c11);
  const a12 = Math.abs(c12);
  const a21 = Math.abs(c21);
  const a22 = Math.abs(c22);

  const faceAx = Math.abs(dAx) - A.hw - (a11 * B.hw + a12 * B.hh);
  const faceAy = Math.abs(dAy) - A.hh - (a21 * B.hw + a22 * B.hh);
  if (faceAx > 0 || faceAy > 0) return [];
  const faceBx = Math.abs(dBx) - (a11 * A.hw + a21 * A.hh) - B.hw;
  const faceBy = Math.abs(dBy) - (a12 * A.hw + a22 * A.hh) - B.hh;
  if (faceBx > 0 || faceBy > 0) return [];

  const relativeTol = 0.95;
  const absoluteTol = 0.01;
  let axis = 0;
  let separation = faceAx;
  let nx = dAx > 0 ? ca : -ca;
  let ny = dAx > 0 ? sa : -sa;
  if (faceAy > relativeTol * separation + absoluteTol * A.hh) {
    axis = 1;
    separation = faceAy;
    nx = dAy > 0 ? -sa : sa;
    ny = dAy > 0 ? ca : -ca;
  }
  if (faceBx > relativeTol * separation + absoluteTol * B.hw) {
    axis = 2;
    separation = faceBx;
    nx = dBx > 0 ? cb : -cb;
    ny = dBx > 0 ? sb : -sb;
  }
  if (faceBy > relativeTol * separation + absoluteTol * B.hh) {
    axis = 3;
    separation = faceBy;
    nx = dBy > 0 ? -sb : sb;
    ny = dBy > 0 ? cb : -cb;
  }

  let fnx: number, fny: number, front: number, snx: number, sny: number;
  let negSide: number, posSide: number, negEdge: number, posEdge: number;
  let incident: ClipVertex[];
  if (axis === 0) {
    fnx = nx; fny = ny;
    front = A.x * fnx + A.y * fny + A.hw;
    snx = -sa; sny = ca;
    const side = A.x * snx + A.y * sny;
    negSide = -side + A.hh; posSide = side + A.hh;
    negEdge = EDGE3; posEdge = EDGE1;
    incident = incidentEdge(B.hw, B.hh, B.x, B.y, cb, sb, fnx, fny);
  } else if (axis === 1) {
    fnx = nx; fny = ny;
    front = A.x * fnx + A.y * fny + A.hh;
    snx = ca; sny = sa;
    const side = A.x * snx + A.y * sny;
    negSide = -side + A.hw; posSide = side + A.hw;
    negEdge = EDGE2; posEdge = EDGE4;
    incident = incidentEdge(B.hw, B.hh, B.x, B.y, cb, sb, fnx, fny);
  } else if (axis === 2) {
    fnx = -nx; fny = -ny;
    front = B.x * fnx + B.y * fny + B.hw;
    snx = -sb; sny = cb;
    const side = B.x * snx + B.y * sny;
    negSide = -side + B.hh; posSide = side + B.hh;
    negEdge = EDGE3; posEdge = EDGE1;
    incident = incidentEdge(A.hw, A.hh, A.x, A.y, ca, sa, fnx, fny);
  } else {
    fnx = -nx; fny = -ny;
    front = B.x * fnx + B.y * fny + B.hh;
    snx = cb; sny = sb;
    const side = B.x * snx + B.y * sny;
    negSide = -side + B.hw; posSide = side + B.hw;
    negEdge = EDGE2; posEdge = EDGE4;
    incident = incidentEdge(A.hw, A.hh, A.x, A.y, ca, sa, fnx, fny);
  }

  const clip1 = clipSegment(incident, -snx, -sny, negSide, negEdge);
  if (clip1.length < 2) return [];
  const clip2 = clipSegment(clip1, snx, sny, posSide, posEdge);
  if (clip2.length < 2) return [];

  const contacts: Contact[] = [];
  for (const v of clip2) {
    const sep = fnx * v.x + fny * v.y - front;
    if (sep <= 0) {
      contacts.push(
        contact(v.x - sep * fnx, v.y - sep * fny, nx, ny, sep, axis >= 2 ? flippedFeature(v) : feature(v)),
      );
    }
  }
  return contacts;
}

/** Box (A) against circle (B), normal from A to B. */
function collideBoxCircle(A: Body, B: Body): Contact[] {
  const c = Math.cos(A.angle);
  const s = Math.sin(A.angle);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const lx = c * dx + s * dy;
  const ly = -s * dx + c * dy;
  const qx = Math.max(-A.hw, Math.min(A.hw, lx));
  const qy = Math.max(-A.hh, Math.min(A.hh, ly));
  let nlx: number, nly: number, separation: number, px: number, py: number;
  if (qx === lx && qy === ly) {
    // Circle centre inside the box: push out through the nearest face.
    const ex = A.hw - Math.abs(lx);
    const ey = A.hh - Math.abs(ly);
    if (ex < ey) {
      nlx = lx >= 0 ? 1 : -1; nly = 0;
      separation = -ex - B.radius;
      px = nlx * A.hw; py = ly;
    } else {
      nlx = 0; nly = ly >= 0 ? 1 : -1;
      separation = -ey - B.radius;
      px = lx; py = nly * A.hh;
    }
  } else {
    const ox = lx - qx;
    const oy = ly - qy;
    const distance = Math.hypot(ox, oy);
    separation = distance - B.radius;
    if (separation > 0) return [];
    nlx = ox / distance;
    nly = oy / distance;
    px = qx;
    py = qy;
  }
  const nx = c * nlx - s * nly;
  const ny = s * nlx + c * nly;
  const wx = A.x + c * px - s * py;
  const wy = A.y + s * px + c * py;
  return [contact(wx, wy, nx, ny, separation, 0)];
}

function collideCircles(A: Body, B: Body): Contact[] {
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const distance = Math.hypot(dx, dy);
  const separation = distance - A.radius - B.radius;
  if (separation > 0) return [];
  const nx = distance > 1e-6 ? dx / distance : 0;
  const ny = distance > 1e-6 ? dy / distance : 1;
  return [contact(A.x + nx * (A.radius + separation / 2), A.y + ny * (A.radius + separation / 2), nx, ny, separation, 0)];
}

/** All contact points between two bodies (empty when apart). */
export function collide(a: Body, b: Body): Contact[] {
  if (a.shape === 'box' && b.shape === 'box') return collideBoxes(a, b);
  if (a.shape === 'circle' && b.shape === 'circle') return collideCircles(a, b);
  if (a.shape === 'box') return collideBoxCircle(a, b);
  // Circle (a) against box (b): collide box→circle and flip the normal.
  return collideBoxCircle(b, a).map((c) => ({ ...c, nx: -c.nx, ny: -c.ny }));
}
