import { createFluid, type Fluid as FluidEffect, type FluidOptions } from '@elementalfx/fluid';
import { effectComponent, useElementalEffect, type EffectHandle } from './shared';

export type { FluidEffect, FluidOptions };

/**
 * A fluid simulation behind the element's content, or a cursor trail over
 * the whole page with `page`.
 *
 * ```tsx
 * <Fluid className="hero" options={{ preset: 'neon' }}>…</Fluid>
 * <Fluid page options={{ preset: 'smoke' }} />
 * ```
 */
export const Fluid = effectComponent<FluidEffect, FluidOptions>('Fluid', createFluid);

/** Fluid on your own element (attach `ref`), or a page-wide cursor trail with `page`. */
export function useFluid<E extends HTMLElement = HTMLElement>(options: FluidOptions = {}, page = false): EffectHandle<FluidEffect, E> {
  return useElementalEffect<FluidEffect, FluidOptions, E>(createFluid, options, page);
}
