import { defineEffectElement, type EffectElement } from '@elementalfx/core';
import { createFluid, type Fluid } from './fluid';
import type { FluidOptions } from './options';

/** `<fx-fluid>`: a fluid background behind its content, or a page-wide cursor trail with `page`. */
export type FluidElement = EffectElement<Fluid>;

export const fluidAttributes = {
  preset: { option: 'preset', type: 'string' },
  mode: { option: 'mode', type: 'string' },
  colors: { option: 'colors', type: 'list' },
  brightness: { option: 'brightness', type: 'number' },
  'dye-dissipation': { option: 'dyeDissipation', type: 'number' },
  'velocity-dissipation': { option: 'velocityDissipation', type: 'number' },
  curl: { option: 'curl', type: 'number' },
  'splat-radius': { option: 'splatRadius', type: 'number' },
  'splat-force': { option: 'splatForce', type: 'number' },
  ambient: { option: 'ambient', type: 'number' },
  shading: { option: 'shading', type: 'number' },
  opacity: { option: 'opacity', type: 'number' },
  quality: { option: 'quality', type: 'string' },
  interactive: { option: 'interactive', type: 'boolean' },
  page: { option: 'page', type: 'boolean' },
} as const;

/**
 * Registers `<fx-fluid>` (or a custom tag name). Safe to call more than once
 * and during server rendering, where it does nothing.
 */
export function defineFluid(tagName = 'fx-fluid'): CustomElementConstructor | undefined {
  return defineEffectElement(tagName, {
    attributes: { ...fluidAttributes },
    hostStyle: { display: 'block' },
    create: (host, options) => {
      const { page, colors, ...rest } = options as FluidOptions & { page?: boolean; colors?: string[] };
      const palette = colors && colors.length === 1 && colors[0] === 'rainbow' ? 'rainbow' : colors;
      return createFluid(page ? document.body : host, { ...rest, ...(palette ? { colors: palette } : {}) });
    },
  });
}

defineFluid();

declare global {
  interface HTMLElementTagNameMap {
    'fx-fluid': FluidElement;
  }
}
