import { defineEffectElement, type EffectElement } from '@elementalfx/core';
import { createGravity, type Gravity } from './gravity';
import type { GravityOptions } from './options';

/** `<fx-gravity>`: its contents fall on cue. Add `page` to drop the whole page instead. */
export type GravityElement = EffectElement<Gravity>;

export const gravityAttributes = {
  selector: { option: 'selector', type: 'string' },
  'split-text': { option: 'splitText', type: 'string' },
  gravity: { option: 'gravity', type: 'number' },
  bounce: { option: 'bounce', type: 'number' },
  friction: { option: 'friction', type: 'number' },
  spin: { option: 'spin', type: 'number' },
  walls: { option: 'walls', type: 'string' },
  'only-visible': { option: 'onlyVisible', type: 'boolean' },
  'max-bodies': { option: 'maxBodies', type: 'number' },
  interactive: { option: 'interactive', type: 'boolean' },
  trigger: { option: 'trigger', type: 'string' },
  'restore-on-escape': { option: 'restoreOnEscape', type: 'boolean' },
  'restore-duration': { option: 'restoreDuration', type: 'number' },
  page: { option: 'page', type: 'boolean' },
} as const;

/**
 * Registers `<fx-gravity>` (or a custom tag name). Safe to call more than once
 * and during server rendering, where it does nothing.
 */
export function defineGravity(tagName = 'fx-gravity'): CustomElementConstructor | undefined {
  return defineEffectElement(tagName, {
    attributes: { ...gravityAttributes },
    hostStyle: { display: 'block' },
    create: (host, options) => {
      const { page, ...rest } = options as GravityOptions & { page?: boolean };
      return createGravity(page ? document.body : host, rest);
    },
  });
}

defineGravity();

declare global {
  interface HTMLElementTagNameMap {
    'fx-gravity': GravityElement;
  }
}
