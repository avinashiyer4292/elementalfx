import { defineEffectElement, type EffectElement } from '@elementalfx/core';
import { createRipples, type Ripples } from './ripples';
import type { RipplesOptions } from './options';

/** `<fx-ripples>`: ripples on its background image or on the image/video inside it. */
export type RipplesElement = EffectElement<Ripples>;

export const ripplesAttributes = {
  preset: { option: 'preset', type: 'string' },
  src: { option: 'source', type: 'string' },
  fit: { option: 'fit', type: 'string' },
  resolution: { option: 'resolution', type: 'number' },
  'drop-radius': { option: 'dropRadius', type: 'number' },
  perturbance: { option: 'perturbance', type: 'number' },
  damping: { option: 'damping', type: 'number' },
  highlight: { option: 'highlight', type: 'number' },
  interactive: { option: 'interactive', type: 'boolean' },
  rain: { option: 'rain', type: 'boolean' },
  'idle-timeout': { option: 'idleTimeout', type: 'number' },
} as const;

/**
 * Registers `<fx-ripples>` (or a custom tag name). Safe to call more than once
 * and during server rendering, where it does nothing.
 */
export function defineRipples(tagName = 'fx-ripples'): CustomElementConstructor | undefined {
  return defineEffectElement(tagName, {
    attributes: { ...ripplesAttributes },
    hostStyle: { display: 'block', position: 'relative' },
    create: (host, options) => createRipples(host, options as RipplesOptions),
  });
}

defineRipples();

declare global {
  interface HTMLElementTagNameMap {
    'fx-ripples': RipplesElement;
  }
}
