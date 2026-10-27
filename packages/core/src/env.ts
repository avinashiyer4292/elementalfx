/** True when running in a browser with a DOM. Safe to evaluate during SSR. */
export const isBrowser: boolean =
  typeof window !== 'undefined' && typeof document !== 'undefined';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Whether the user has asked the operating system to reduce motion. */
export function prefersReducedMotion(): boolean {
  return (
    isBrowser &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

/**
 * Calls `callback` whenever the reduced-motion preference changes.
 * Returns a function that stops watching.
 */
export function watchReducedMotion(callback: (reduce: boolean) => void): () => void {
  if (!isBrowser || typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  const handler = (): void => callback(query.matches);
  query.addEventListener('change', handler);
  return () => query.removeEventListener('change', handler);
}

/** The device pixel ratio, capped to keep fill-rate costs bounded on dense screens. */
export function pixelRatio(max = 2): number {
  const dpr = isBrowser ? window.devicePixelRatio || 1 : 1;
  return Math.max(1, Math.min(max, dpr));
}

/** Resolves an element or a CSS selector to an element, throwing a clear error if missing. */
export function resolveElement<T extends Element = HTMLElement>(target: T | string): T {
  if (typeof target !== 'string') return target;
  const found = document.querySelector<T & Element>(target);
  if (!found) throw new Error(`[elementalfx] No element matches "${target}"`);
  return found as T;
}
