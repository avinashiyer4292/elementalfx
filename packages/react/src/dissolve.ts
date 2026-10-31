import { assemble, dissolve, type DissolveOptions } from '@elementalfx/dissolve';
import { createElement, useCallback, useRef, type AllHTMLAttributes, type ReactElement, type ReactNode, type RefObject } from 'react';
import { useIsomorphicLayoutEffect } from './shared';

export type { DissolveOptions };

export interface DissolveProps extends Omit<AllHTMLAttributes<HTMLElement>, 'as'> {
  /** Whether the children are there. Turning it off dissolves them; turning it on assembles them. */
  show: boolean;
  /** Effect options. `after` is always 'hide', since React owns the element. */
  options?: Omit<DissolveOptions, 'after'>;
  /** Element to render. Default 'div'. */
  as?: string;
  /** Called when an animation finishes, with the new `show` value. */
  onDone?: (shown: boolean) => void;
  children?: ReactNode;
}

/**
 * Wraps content that crumbles to dust, burns or melts away when `show`
 * turns off, and comes back the same way when it turns on. Content that
 * starts with `show` off is hidden from the first frame, keeping its space.
 *
 * ```tsx
 * <Dissolve show={open} options={{ effect: 'burn' }}>
 *   <Card />
 * </Dissolve>
 * ```
 */
export function Dissolve({ show, options, as = 'div', onDone, children, ...rest }: DissolveProps): ReactElement {
  const ref = useRef<HTMLElement | null>(null);
  const shown = useRef<boolean | null>(null);
  const latest = useRef({ options, onDone });
  latest.current = { options, onDone };

  useIsomorphicLayoutEffect(() => {
    const element = ref.current;
    // Strict Mode runs effects twice; only a real change animates.
    if (!element || shown.current === show) return;
    const first = shown.current === null;
    shown.current = show;
    if (first) {
      if (!show) void dissolve(element, { duration: 0 });
      return;
    }
    let current = true;
    const settings = { ...latest.current.options, after: 'hide' as const };
    void (show ? assemble(element, settings) : dissolve(element, settings)).then(() => {
      if (current) latest.current.onDone?.(show);
    });
    return () => {
      current = false;
    };
  }, [show]);

  return createElement(as, { ref, ...rest }, children);
}

export interface DissolveHandle<E extends HTMLElement> {
  /** Attach to the element to animate. */
  ref: RefObject<E | null>;
  dissolve(options?: DissolveOptions): Promise<void>;
  assemble(options?: DissolveOptions): Promise<void>;
}

/** Dissolve and assemble your own element on demand. */
export function useDissolve<E extends HTMLElement = HTMLElement>(defaults: DissolveOptions = {}): DissolveHandle<E> {
  const ref = useRef<E | null>(null);
  const base = useRef(defaults);
  base.current = defaults;
  const run = useCallback(
    (reverse: boolean, options?: DissolveOptions): Promise<void> => {
      const element = ref.current;
      if (!element) return Promise.resolve();
      const settings = { ...base.current, ...options };
      return reverse ? assemble(element, settings) : dissolve(element, settings);
    },
    [],
  );
  return {
    ref,
    dissolve: useCallback((options?: DissolveOptions) => run(false, options), [run]),
    assemble: useCallback((options?: DissolveOptions) => run(true, options), [run]),
  };
}
