import { defineEffectElement, type EffectElement } from '@elementalfx/core';
import { createWeather, type Weather } from './weather';
import type { WeatherOptions } from './options';

/** `<fx-weather>`: weather over its own box, or over the whole page with the `page` attribute. */
export type WeatherElement = EffectElement<Weather>;

export const weatherAttributes = {
  preset: { option: 'preset', type: 'string' },
  effects: { option: 'effects', type: 'list' },
  intensity: { option: 'intensity', type: 'number' },
  'wind-direction': { option: 'wind.direction', type: 'number' },
  'wind-speed': { option: 'wind.speed', type: 'number' },
  'wind-gusts': { option: 'wind.gusts', type: 'number' },
  'wind-turbulence': { option: 'wind.turbulence', type: 'number' },
  'settle-on': { option: 'settleOn', type: 'string' },
  'max-snow-depth': { option: 'maxSnowDepth', type: 'number' },
  'settle-speed': { option: 'settleSpeed', type: 'number' },
  'lightning-rate': { option: 'lightning.rate', type: 'number' },
  'fog-density': { option: 'fog.density', type: 'number' },
  layer: { option: 'layer', type: 'string' },
  seed: { option: 'seed', type: 'number' },
  page: { option: 'page', type: 'boolean' },
} as const;

/**
 * Registers `<fx-weather>` (or a custom tag name). Safe to call more than once
 * and during server rendering, where it does nothing.
 */
export function defineWeather(tagName = 'fx-weather'): CustomElementConstructor | undefined {
  return defineEffectElement(tagName, {
    attributes: { ...weatherAttributes },
    hostStyle: { display: 'block' },
    create: (host, options) => {
      const { page, ...rest } = options as WeatherOptions & { page?: boolean };
      return createWeather(page ? document.body : host, rest);
    },
  });
}

defineWeather();

declare global {
  interface HTMLElementTagNameMap {
    'fx-weather': WeatherElement;
  }
}
