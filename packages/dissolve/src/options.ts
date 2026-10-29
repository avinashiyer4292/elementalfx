export type DissolveEffect = 'dust' | 'burn' | 'melt' | 'fade';
/** Which way the vanishing edge travels across the element. 'none' scatters it everywhere at once. */
export type DissolveDirection = 'left' | 'right' | 'up' | 'down' | 'none';

export interface DissolveOptions {
  /**
   * - 'dust': crumbles into specks that blow away (default)
   * - 'burn': a glowing edge eats through it, leaving charred edges and sparks
   * - 'melt': drips down and fades
   * - 'fade': a soft, noisy fade
   */
  effect?: DissolveEffect;
  /** Seconds. Default 1.6 (burn 2.2, melt 1.8, fade 1). */
  duration?: number;
  /** Which way the edge travels. Default 'right' for dust, 'up' for burn, 'none' for fade. */
  direction?: DissolveDirection;
  /** How ragged the edge is, 0 (a straight line) to 1 (blotches all over). Default 0.4. */
  noise?: number;
  /** Size of the blotches in px. Default 36. */
  scale?: number;
  /** Fire color for 'burn'. Default '#ff7a1a'. */
  color?: string;
  /** How many dust specks or sparks, as a multiple of the default. Default 1. */
  particles?: number;
  /** Size of a dust speck in px. Default 3. */
  grain?: number;
  /** What happens to the element once it has gone: hide it (keeping its space) or remove it. Default 'hide'. */
  after?: 'hide' | 'remove';
  /** Same seed, same pattern. Default random. */
  seed?: number;
  /** Fade simply instead when the user prefers reduced motion. Default true. */
  respectReducedMotion?: boolean;
}

export type ResolvedDissolveOptions = Required<Omit<DissolveOptions, 'direction' | 'duration' | 'seed'>> & {
  direction: DissolveDirection;
  duration: number;
  seed: number;
};

const durations: Record<DissolveEffect, number> = { dust: 1.6, burn: 2.2, melt: 1.8, fade: 1 };
const directions: Record<DissolveEffect, DissolveDirection> = { dust: 'right', burn: 'up', melt: 'down', fade: 'none' };

export function resolveOptions(options: DissolveOptions = {}): ResolvedDissolveOptions {
  const effect = options.effect && options.effect in durations ? options.effect : 'dust';
  return {
    effect,
    duration: Math.max(0.05, options.duration ?? durations[effect]),
    direction: options.direction ?? directions[effect],
    noise: Math.min(1, Math.max(0, options.noise ?? 0.4)),
    scale: Math.max(4, options.scale ?? 36),
    color: options.color ?? '#ff7a1a',
    particles: Math.max(0, options.particles ?? 1),
    grain: Math.max(1, options.grain ?? 3),
    after: options.after === 'remove' ? 'remove' : 'hide',
    seed: options.seed ?? Math.floor(Math.random() * 2 ** 31),
    respectReducedMotion: options.respectReducedMotion ?? true,
  };
}
