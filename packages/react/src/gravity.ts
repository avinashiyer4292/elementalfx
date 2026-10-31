import { createGravity, type Gravity as GravityEffect, type GravityOptions } from '@elementalfx/gravity';
import { effectComponent, useElementalEffect, type EffectHandle } from './shared';

export type { GravityEffect, GravityOptions };

/**
 * Lets the element's contents fall and be thrown around, or the whole page's
 * with `page`. Drop it with a trigger option, or from `onReady`:
 *
 * ```tsx
 * <Gravity options={{ trigger: 'konami' }}>…</Gravity>
 * <Gravity page onReady={(gravity) => (window.drop = () => gravity.drop())} />
 * ```
 */
export const Gravity = effectComponent<GravityEffect, GravityOptions>('Gravity', createGravity);

/**
 * Gravity on your own element (attach `ref`) or the whole page with `page`.
 * `instance.drop()` and `instance.restore()` do the rest.
 */
export function useGravity<E extends HTMLElement = HTMLElement>(options: GravityOptions = {}, page = false): EffectHandle<GravityEffect, E> {
  return useElementalEffect<GravityEffect, GravityOptions, E>(createGravity, options, page);
}
