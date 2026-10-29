import { createRandom, noise3 } from '@elementalfx/core';
import type { DissolveDirection } from './options';

/**
 * The order in which an element's pixels vanish: a value from 0 (first) to 1
 * (last) for every spot, made of a sweep in one direction roughened by noise.
 * The SVG filter reads it as an image; the dust and sparks read the numbers,
 * so particles leave from exactly where the element disappears.
 */
export interface Mask {
  /** Element size in CSS px. */
  width: number;
  height: number;
  /** CSS px per mask texel. */
  step: number;
  columns: number;
  rows: number;
  values: Float32Array;
  /** PNG data URL with the values in its alpha channel. */
  url: string;
  /** The value at a point in element px. */
  at(x: number, y: number): number;
}

function fbm(x: number, y: number, z: number): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let octave = 0; octave < 3; octave++) {
    sum += amplitude * noise3(x * frequency, y * frequency, z + octave * 7.31);
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum;
}

function ramp(direction: DissolveDirection, u: number, v: number): number {
  switch (direction) {
    case 'right':
      return u;
    case 'left':
      return 1 - u;
    case 'down':
      return v;
    case 'up':
      return 1 - v;
    default:
      return 0;
  }
}

function toPng(columns: number, rows: number, fill: (data: Uint8ClampedArray) => void): string {
  const canvas = document.createElement('canvas');
  canvas.width = columns;
  canvas.height = rows;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(columns, rows);
  fill(image.data);
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

export function createMask(
  width: number,
  height: number,
  options: { direction: DissolveDirection; noise: number; scale: number; seed: number },
): Mask {
  // Small enough to build in a millisecond or two; the filter scales it up smoothly.
  const step = Math.max(4, Math.ceil(Math.max(width, height) / 256));
  const columns = Math.max(2, Math.ceil(width / step));
  const rows = Math.max(2, Math.ceil(height / step));
  const values = new Float32Array(columns * rows);
  const random = createRandom(options.seed);
  const z = random() * 100;
  const offsetX = random() * 1000;
  const offsetY = random() * 1000;
  const noise = options.direction === 'none' ? 1 : options.noise;
  const frequency = step / options.scale;
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const n = fbm(offsetX + i * frequency, offsetY + j * frequency, z) * 0.9 + 0.5;
      const value = (1 - noise) * ramp(options.direction, i / (columns - 1), j / (rows - 1)) + noise * n;
      values[j * columns + i] = value;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  const range = max - min || 1;
  for (let k = 0; k < values.length; k++) values[k] = (values[k]! - min) / range;

  const url = toPng(columns, rows, (data) => {
    for (let k = 0; k < values.length; k++) {
      data[k * 4] = 255;
      data[k * 4 + 1] = 255;
      data[k * 4 + 2] = 255;
      data[k * 4 + 3] = Math.round(values[k]! * 255);
    }
  });

  return {
    width,
    height,
    step,
    columns,
    rows,
    values,
    url,
    at(x, y) {
      const i = Math.min(columns - 1, Math.max(0, Math.floor(x / step)));
      const j = Math.min(rows - 1, Math.max(0, Math.floor(y / step)));
      return values[j * columns + i]!;
    },
  };
}

/**
 * A displacement map for melting: each column drips by its own amount, more
 * the lower it is. It covers `reach` times the element's height, since
 * melted content runs out of the element's box.
 */
export function createDrip(width: number, height: number, reach: number, seed: number): string {
  const step = Math.max(4, Math.ceil(Math.max(width, height * reach) / 256));
  const columns = Math.max(2, Math.ceil(width / step));
  const rows = Math.max(2, Math.ceil((height * reach) / step));
  const random = createRandom(seed);
  const z = random() * 100;
  const drips = new Float32Array(columns);
  for (let i = 0; i < columns; i++) {
    // Narrow runs between slower stretches.
    const n = noise3((i * step) / 18, z, 0.5) * 0.55 + noise3((i * step) / 60, z, 3.1) * 0.45 + 0.5;
    drips[i] = 0.15 + 0.85 * Math.pow(Math.min(1, Math.max(0, n)), 2.4);
  }
  return toPng(columns, rows, (data) => {
    for (let j = 0; j < rows; j++) {
      const depth = Math.min(1, (j * step) / height);
      for (let i = 0; i < columns; i++) {
        // The top stays put; the lower it is, the further it runs.
        const amount = drips[i]! * Math.pow(depth, 1.3);
        const k = (j * columns + i) * 4;
        data[k] = 128;
        // Below 128 pulls content down from above.
        data[k + 1] = Math.round(128 - amount * 127);
        data[k + 2] = 128;
        data[k + 3] = 255;
      }
    }
  });
}
