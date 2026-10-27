export type FluidPreset = 'smoke' | 'ink' | 'neon';
export type FluidMode = 'cursor' | 'background';
export type FluidQuality = 'auto' | 'low' | 'medium' | 'high';

export interface FluidOptions {
  /** Starting values for every option below. Default 'ink'. */
  preset?: FluidPreset;
  /**
   * 'cursor': a transparent overlay over the whole page that follows the pointer.
   * 'background': fills the element behind its content. Defaults to 'cursor'
   * on `document.body` and 'background' on any other element.
   */
  mode?: FluidMode;
  /** Dye colors as CSS hex strings, or 'rainbow' for random hues. */
  colors?: string[] | 'rainbow';
  /** Brightness of injected dye. Default 0.15. */
  brightness?: number;
  /** How fast dye fades, per second. Default 1. */
  dyeDissipation?: number;
  /** How fast motion fades, per second. Default 0.2. */
  velocityDissipation?: number;
  /** Fraction of pressure kept between frames, 0 to 1. Default 0.8. */
  pressure?: number;
  /** Swirl strength (vorticity confinement). Default 30. */
  curl?: number;
  /** Splat size, as a fraction of the area. Default 0.25. */
  splatRadius?: number;
  /** How hard pointer movement pushes the fluid. Default 6000. */
  splatForce?: number;
  /** Invisible strokes that keep a background flowing on its own. Default 0 (cursor) or 1 (background). */
  ambient?: number;
  /** Soft 3D shading from dye density, 0 to 1. Default 1. */
  shading?: number;
  /** Maximum opacity of the overlay, 0 to 1. Default 1. */
  opacity?: number;
  /** Simulation detail. 'auto' starts by device and steps down if frames run slow. Default 'auto'. */
  quality?: FluidQuality;
  /** Pointer movement stirs the fluid. Default true. */
  interactive?: boolean;
  /** CSS z-index of the cursor overlay. Default 2147483000. */
  zIndex?: number;
  /** Skip the effect when the user prefers reduced motion. Default true. */
  respectReducedMotion?: boolean;
  /** Stop animating while scrolled out of view. Default true. */
  pauseOffscreen?: boolean;
  /** Upper bound for devicePixelRatio. Default 2. */
  maxPixelRatio?: number;
}

export type ResolvedFluidOptions = Required<Omit<FluidOptions, 'mode' | 'ambient'>> & {
  mode: FluidMode | null;
  ambient: number | null;
  colors: string[] | 'rainbow';
};

const base: Omit<ResolvedFluidOptions, 'preset'> = {
  mode: null,
  colors: 'rainbow',
  brightness: 0.2,
  dyeDissipation: 1,
  velocityDissipation: 0.2,
  pressure: 0.8,
  curl: 30,
  splatRadius: 0.25,
  splatForce: 6000,
  ambient: null,
  shading: 1,
  opacity: 1,
  quality: 'auto',
  interactive: true,
  zIndex: 2147483000,
  respectReducedMotion: true,
  pauseOffscreen: true,
  maxPixelRatio: 2,
};

export const presets: Record<FluidPreset, Partial<FluidOptions>> = {
  ink: {},
  smoke: {
    colors: ['#ffffff'],
    brightness: 0.09,
    dyeDissipation: 1.4,
    velocityDissipation: 0.5,
    curl: 18,
    splatRadius: 0.18,
    shading: 0.6,
  },
  neon: {
    colors: ['#18e7ff', '#ff2bd6', '#7dff5a', '#ffd400', '#8a5cff'],
    brightness: 0.22,
    dyeDissipation: 1.1,
    curl: 45,
    shading: 0.3,
  },
};

export interface QualityTier {
  name: 'low' | 'medium' | 'high';
  sim: number;
  dye: number;
  iterations: number;
}

export const tiers: QualityTier[] = [
  { name: 'low', sim: 64, dye: 256, iterations: 10 },
  { name: 'medium', sim: 96, dye: 512, iterations: 16 },
  { name: 'high', sim: 128, dye: 1024, iterations: 20 },
];

export function resolveOptions(options: FluidOptions): ResolvedFluidOptions {
  const preset = options.preset && presets[options.preset] ? options.preset : 'ink';
  const merged: Record<string, unknown> = { ...base, ...presets[preset] };
  for (const [key, value] of Object.entries(options)) if (value !== undefined) merged[key] = value;
  merged.preset = preset;
  return merged as ResolvedFluidOptions;
}
