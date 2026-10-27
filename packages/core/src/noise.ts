/**
 * Small, deterministic 3D gradient noise (improved Perlin) and a seeded
 * random generator. Output of `noise3` is roughly in [-1, 1].
 */

/** Mulberry32: a tiny seeded PRNG returning floats in [0, 1). */
export function createRandom(seed = 1): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const permutation = new Uint8Array(512);
{
  const random = createRandom(1337);
  const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const swap = base[i]!;
    base[i] = base[j]!;
    base[j] = swap;
  }
  for (let i = 0; i < 512; i++) permutation[i] = base[i & 255]!;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function grad(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Improved Perlin noise. Smooth, continuous, roughly within [-1, 1]. */
export function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const X = xi & 255;
  const Y = yi & 255;
  const Z = zi & 255;
  x -= xi;
  y -= yi;
  z -= zi;
  const u = fade(x);
  const v = fade(y);
  const w = fade(z);
  const p = permutation;
  const A = p[X]! + Y;
  const AA = p[A]! + Z;
  const AB = p[A + 1]! + Z;
  const B = p[X + 1]! + Y;
  const BA = p[B]! + Z;
  const BB = p[B + 1]! + Z;
  return lerp(
    lerp(
      lerp(grad(p[AA]!, x, y, z), grad(p[BA]!, x - 1, y, z), u),
      lerp(grad(p[AB]!, x, y - 1, z), grad(p[BB]!, x - 1, y - 1, z), u),
      v,
    ),
    lerp(
      lerp(grad(p[AA + 1]!, x, y, z - 1), grad(p[BA + 1]!, x - 1, y, z - 1), u),
      lerp(grad(p[AB + 1]!, x, y - 1, z - 1), grad(p[BB + 1]!, x - 1, y - 1, z - 1), u),
      v,
    ),
    w,
  );
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Random float in [min, max) using the supplied generator. */
export function randomBetween(random: () => number, min: number, max: number): number {
  return min + (max - min) * random();
}
