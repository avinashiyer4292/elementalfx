import { createRipples, type Ripples as RipplesEffect, type RipplesOptions } from '@elementalfx/ripples';
import { effectComponent, useElementalEffect, type EffectHandle } from './shared';

export type { RipplesEffect, RipplesOptions };

/**
 * Water ripples on the element's CSS background, on an image with
 * `as="img"`, or on the page's background with `page`. Children render on top.
 *
 * ```tsx
 * <Ripples className="hero" options={{ preset: 'rain' }}>…</Ripples>
 * <Ripples as="img" src="/lake.jpg" alt="" options={{ interactive: true }} />
 * ```
 */
export const Ripples = effectComponent<RipplesEffect, RipplesOptions>('Ripples', createRipples);

/** Ripples on your own element (attach `ref`), or on the page's background with `page`. */
export function useRipples<E extends HTMLElement = HTMLElement>(options: RipplesOptions = {}, page = false): EffectHandle<RipplesEffect, E> {
  return useElementalEffect<RipplesEffect, RipplesOptions, E>(createRipples, options, page);
}
