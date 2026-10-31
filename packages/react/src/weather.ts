import { createWeather, type Weather as WeatherEffect, type WeatherOptions } from '@elementalfx/weather';
import { effectComponent, useElementalEffect, type EffectHandle } from './shared';

export type { WeatherEffect, WeatherOptions };

/**
 * Snow, rain, fog, lightning, leaves or embers over the element, or over the
 * whole page with `page`.
 *
 * ```tsx
 * <Weather page options={{ preset: 'snow' }} />
 * <Weather className="banner" options={{ preset: 'storm' }}>…</Weather>
 * ```
 */
export const Weather = effectComponent<WeatherEffect, WeatherOptions>('Weather', createWeather);

/** Weather on your own element (attach `ref`), or on the whole page with `page`. */
export function useWeather<E extends HTMLElement = HTMLElement>(options: WeatherOptions = {}, page = false): EffectHandle<WeatherEffect, E> {
  return useElementalEffect<WeatherEffect, WeatherOptions, E>(createWeather, options, page);
}
