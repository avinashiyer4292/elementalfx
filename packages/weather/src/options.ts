import type { WindOptions } from '@elementalfx/core';

export type WeatherEffect = 'snow' | 'rain' | 'fog' | 'lightning' | 'leaves' | 'embers';

export const ALL_EFFECTS: readonly WeatherEffect[] = ['fog', 'snow', 'rain', 'leaves', 'embers', 'lightning'];

export type WeatherPreset =
  | 'light-snow'
  | 'snow'
  | 'blizzard'
  | 'drizzle'
  | 'rain'
  | 'storm'
  | 'autumn'
  | 'fireplace'
  | 'mist';

export interface ParticleOptions {
  /** Multiplier on the default particle count. Default 1. */
  density?: number;
  /** Size range in CSS px. */
  size?: [number, number];
  /** Multiplier on fall (or rise) speed. Default 1. */
  speed?: number;
  /** Opacity range, 0 to 1. */
  opacity?: [number, number];
  /** Colors particles pick from, as CSS hex strings. */
  colors?: string[];
}

export interface RainOptions extends ParticleOptions {
  /** Small droplets bounce up where rain lands. Default true. */
  splashes?: boolean;
}

export interface FogOptions {
  /** 0 (clear) to 1 (thick). Default 0.5. */
  density?: number;
  /** Fog color as a CSS hex string. */
  color?: string;
  /** Fraction of the area, from the bottom, that fog fills. Default 1. */
  height?: number;
  /** Pointer clears a hole of this radius in CSS px. 0 turns it off. Default 140. */
  pointerRadius?: number;
}

export interface LightningOptions {
  /** Average strikes per minute. Default 4. */
  rate?: number;
  /** Brightness of the sky flash, 0 to 1. Default 0.35. */
  flash?: number;
  /** Bolt color as a CSS hex string. */
  color?: string;
}

/** Something that accepts drops, such as a `Ripples` instance from @elementalfx/ripples. */
export interface DropTarget {
  readonly element: HTMLElement;
  drop(x: number, y: number, radius?: number, strength?: number): void;
}

export interface WeatherOptions {
  /** Starting effects and settings. */
  preset?: WeatherPreset;
  /** Effects to show, as an array or a space-separated string. */
  effects?: WeatherEffect[] | string;
  /** The wind every effect follows. */
  wind?: WindOptions;
  /** Overall amount of weather, multiplies every particle count. Default 1. */
  intensity?: number;
  snow?: ParticleOptions;
  rain?: RainOptions;
  leaves?: ParticleOptions;
  embers?: ParticleOptions;
  fog?: FogOptions;
  lightning?: LightningOptions;
  /**
   * Elements whose top edges collect snow and splash rain, as a selector or a list.
   * Up to 32 elements are tracked.
   */
  settleOn?: string | Element[] | null;
  /** Tallest snow cap in CSS px. Default 14. */
  maxSnowDepth?: number;
  /** Rain landing on these targets makes them ripple. */
  ripples?: DropTarget[];
  /** 'front' draws over the element's content (default); 'back' draws behind it. */
  layer?: 'front' | 'back';
  /** CSS z-index of the overlay when covering the page. Default 2147483000. */
  zIndex?: number;
  /** Skip the effect when the user prefers reduced motion. Default true. */
  respectReducedMotion?: boolean;
  /** Stop animating while scrolled out of view. Default true. */
  pauseOffscreen?: boolean;
  /** Upper bound for devicePixelRatio. Default 2. */
  maxPixelRatio?: number;
  /** Seed for reproducible particle layouts. */
  seed?: number;
  /** Use the Canvas 2D renderer even when WebGL2 is available. Intended for testing. */
  forceCanvas2D?: boolean;
}

export interface ResolvedWeatherOptions {
  preset: WeatherPreset | null;
  effects: Set<WeatherEffect>;
  wind: Required<WindOptions>;
  intensity: number;
  snow: Required<ParticleOptions>;
  rain: Required<RainOptions>;
  leaves: Required<ParticleOptions>;
  embers: Required<ParticleOptions>;
  fog: Required<FogOptions>;
  lightning: Required<LightningOptions>;
  settleOn: string | Element[] | null;
  maxSnowDepth: number;
  ripples: DropTarget[];
  layer: 'front' | 'back';
  zIndex: number;
  respectReducedMotion: boolean;
  pauseOffscreen: boolean;
  maxPixelRatio: number;
  seed: number;
  forceCanvas2D: boolean;
}

const defaults: ResolvedWeatherOptions = {
  preset: null,
  effects: new Set(),
  wind: { direction: 0, speed: 0.15, gusts: 0.3, turbulence: 0.3, pointer: 0.5 },
  intensity: 1,
  snow: { density: 1, size: [2, 6], speed: 1, opacity: [0.55, 1], colors: ['#ffffff'] },
  rain: { density: 1, size: [14, 26], speed: 1, opacity: [0.25, 0.55], colors: ['#b8cde0'], splashes: true },
  leaves: {
    density: 1,
    size: [18, 32],
    speed: 1,
    opacity: [0.85, 1],
    colors: ['#c4572a', '#e0952f', '#a83a24', '#d9b44a', '#8a5a2b'],
  },
  embers: { density: 1, size: [2.5, 6], speed: 1, opacity: [0.7, 1], colors: ['#ffd27a', '#ff9a3d', '#ff5a1f'] },
  fog: { density: 0.5, color: '#d6dde4', height: 1, pointerRadius: 140 },
  lightning: { rate: 4, flash: 0.35, color: '#e9f0ff' },
  settleOn: null,
  maxSnowDepth: 14,
  ripples: [],
  layer: 'front',
  zIndex: 2147483000,
  respectReducedMotion: true,
  pauseOffscreen: true,
  maxPixelRatio: 2,
  seed: 0,
  forceCanvas2D: false,
};

export const presets: Record<WeatherPreset, WeatherOptions> = {
  'light-snow': { effects: ['snow'], snow: { density: 0.5 }, wind: { speed: 0.08 } },
  snow: { effects: ['snow'] },
  blizzard: {
    effects: ['snow', 'fog'],
    snow: { density: 3, speed: 1.6, size: [1.5, 5] },
    fog: { density: 0.35, color: '#eef3f7' },
    wind: { speed: 0.6, gusts: 0.7, turbulence: 0.6 },
  },
  drizzle: { effects: ['rain'], rain: { density: 0.35, size: [10, 18], opacity: [0.2, 0.4] } },
  rain: { effects: ['rain'], wind: { speed: 0.1 } },
  storm: {
    effects: ['rain', 'fog', 'lightning'],
    rain: { density: 1.8, speed: 1.2 },
    fog: { density: 0.3, color: '#9aa7b4', height: 0.6 },
    wind: { speed: 0.45, gusts: 0.6, turbulence: 0.4, direction: 12 },
  },
  autumn: { effects: ['leaves'], wind: { speed: 0.25, gusts: 0.5, turbulence: 0.5 } },
  fireplace: { effects: ['embers'], wind: { speed: 0.05, turbulence: 0.6, direction: -90 } },
  mist: { effects: ['fog'], fog: { density: 0.6, height: 0.7 } },
};

export function parseEffects(effects: WeatherOptions['effects']): Set<WeatherEffect> {
  const list = typeof effects === 'string' ? effects.split(/[\s,]+/) : (effects ?? []);
  const result = new Set<WeatherEffect>();
  for (const name of list) {
    if ((ALL_EFFECTS as readonly string[]).includes(name)) result.add(name as WeatherEffect);
    else if (name) console.warn(`[elementalfx] weather: unknown effect "${name}"`);
  }
  return result;
}

const nested = ['wind', 'snow', 'rain', 'leaves', 'embers', 'fog', 'lightning'] as const;

/** Merges defaults, the preset and explicit options. Nested groups merge key by key. */
export function resolveOptions(options: WeatherOptions): ResolvedWeatherOptions {
  const preset = options.preset && presets[options.preset] ? options.preset : null;
  const layers: WeatherOptions[] = [preset ? presets[preset] : {}, options];
  const result: ResolvedWeatherOptions = {
    ...defaults,
    preset,
    effects: new Set(),
    ripples: [],
  };
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined || key === 'preset') continue;
      if (key === 'effects') {
        result.effects = parseEffects(value as WeatherOptions['effects']);
      } else if ((nested as readonly string[]).includes(key)) {
        const group = key as (typeof nested)[number];
        (result as unknown as Record<string, unknown>)[group] = {
          ...(result[group] as object),
          ...stripUndefined(value as object),
        };
      } else {
        (result as unknown as Record<string, unknown>)[key] = value;
      }
    }
  }
  return result;
}

/** Deep-merges an options patch into stored options (nested groups merge key by key). */
export function mergeOptions(base: WeatherOptions, patch: WeatherOptions): WeatherOptions {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if ((nested as readonly string[]).includes(key) && value && typeof value === 'object') {
      result[key] = { ...((base as Record<string, unknown>)[key] as object), ...value };
    } else {
      result[key] = value;
    }
  }
  return result as WeatherOptions;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) (result as Record<string, unknown>)[key] = entry;
  }
  return result;
}

/** Parses '#rgb' or '#rrggbb' into 0–1 channels. Falls back to white. */
export function parseColor(hex: string): [number, number, number] {
  let value = hex.trim().replace('#', '');
  if (value.length === 3) value = value.replace(/./g, (c) => c + c);
  const n = Number.parseInt(value, 16);
  if (value.length !== 6 || Number.isNaN(n)) return [1, 1, 1];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
