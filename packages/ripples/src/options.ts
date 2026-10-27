import type { ImageSource } from '@elementalfx/gl';

export type RipplesPreset = 'pond' | 'rain' | 'subtle';

export interface RainOptions {
  /** Drops per second across the whole element. Default 6. */
  rate?: number;
  /** Drop radius range in CSS px. Default [6, 18]. */
  radius?: [number, number];
  /** Drop strength range. Default [0.03, 0.09]. */
  strength?: [number, number];
}

export interface RipplesOptions {
  /** Starting values for every option below. Default 'pond'. */
  preset?: RipplesPreset;
  /**
   * Image to ripple. Defaults to the element's CSS background image, or the
   * first `<img>`/`<video>` inside it, or the element itself if it is one.
   */
  source?: string | ImageSource;
  /** Simulation cells along the longer side. Higher is smoother but slower. Default 256. */
  resolution?: number;
  /** Radius in CSS px of drops made by the pointer. Default 20. */
  dropRadius?: number;
  /** How far the image is displaced by slopes, as a fraction of the element width. Default 0.03. */
  perturbance?: number;
  /** Fraction of wave energy kept each step (60 steps per second). Default 0.995. */
  damping?: number;
  /** Brightness of the highlight on wave slopes, 0 to 1. Default 0.5. */
  highlight?: number;
  /** Pointer movement and clicks make ripples. Default true. */
  interactive?: boolean;
  /** Random drops falling continuously. `true` uses default rain settings. Default false. */
  rain?: boolean | RainOptions;
  /** `crossOrigin` used when loading image URLs. Default 'anonymous'. */
  crossOrigin?: string | null;
  /** Skip the effect when the user prefers reduced motion. Default true. */
  respectReducedMotion?: boolean;
  /** Stop animating while scrolled out of view. Default true. */
  pauseOffscreen?: boolean;
  /** Upper bound for devicePixelRatio when sizing the canvas. Default 2. */
  maxPixelRatio?: number;
  /** Seconds without new drops before the simulation settles and stops drawing. Default 12. */
  idleTimeout?: number;
  /** Force the 8-bit fallback path. Intended for testing. */
  forcePacked?: boolean;
}

export interface ResolvedRainOptions {
  rate: number;
  radius: [number, number];
  strength: [number, number];
}

export type ResolvedRipplesOptions = Required<Omit<RipplesOptions, 'source' | 'rain'>> & {
  source: RipplesOptions['source'];
  rain: ResolvedRainOptions | null;
};

export const defaultRain: ResolvedRainOptions = {
  rate: 6,
  radius: [6, 18],
  strength: [0.03, 0.09],
};

const base: Omit<ResolvedRipplesOptions, 'preset' | 'source'> = {
  resolution: 256,
  dropRadius: 20,
  perturbance: 0.03,
  damping: 0.995,
  highlight: 0.5,
  interactive: true,
  rain: null,
  crossOrigin: 'anonymous',
  respectReducedMotion: true,
  pauseOffscreen: true,
  maxPixelRatio: 2,
  idleTimeout: 12,
  forcePacked: false,
};

export const presets: Record<RipplesPreset, Partial<RipplesOptions>> = {
  pond: {},
  rain: { rain: true, dropRadius: 16 },
  subtle: { perturbance: 0.012, dropRadius: 14, highlight: 0.25, damping: 0.99 },
};

/** Merges defaults, the chosen preset and explicit options into a complete set. */
export function resolveOptions(options: RipplesOptions): ResolvedRipplesOptions {
  const preset = options.preset ?? 'pond';
  const merged = { ...base, ...(presets[preset] ?? {}), ...stripUndefined(options) } as RipplesOptions;
  return {
    ...(merged as Required<RipplesOptions>),
    preset,
    source: options.source,
    rain: resolveRain(merged.rain),
  };
}

function resolveRain(rain: RipplesOptions['rain'] | null): ResolvedRainOptions | null {
  if (!rain) return null;
  if (rain === true) return { ...defaultRain };
  return { ...defaultRain, ...stripUndefined(rain) } as ResolvedRainOptions;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) (result as Record<string, unknown>)[key] = entry;
  }
  return result;
}
