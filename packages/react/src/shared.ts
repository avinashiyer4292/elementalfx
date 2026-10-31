import {
  Fragment,
  createElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type AllHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';

/** What every elementalfx effect instance can do. */
export interface Controllable {
  set(options: never): void;
  destroy(): void;
}

/** Runs before paint in the browser, and quietly does nothing on the server. */
export const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/** A stable key for an options object, so changing options updates the effect instead of recreating it. */
function optionsKey(options: unknown): string {
  try {
    return JSON.stringify(options ?? {}, (_, value: unknown) => (typeof Element !== 'undefined' && value instanceof Element ? `<${value.tagName}>` : value));
  } catch {
    return String(Math.random());
  }
}

export interface EffectHandle<I, E extends HTMLElement = HTMLElement> {
  /** Attach to the element the effect should cover. Not needed with `page`. */
  ref: RefObject<E | null>;
  /** The running effect, or null before mount and after unmount. */
  instance: I | null;
}

/**
 * Creates an effect on mount, destroys it on unmount, and passes option
 * changes to `set()` instead of recreating it. With `page`, the effect covers
 * `document.body` and `ref` can be ignored.
 */
export function useElementalEffect<I extends Controllable, O, E extends HTMLElement = HTMLElement>(
  create: (element: HTMLElement, options: O) => I,
  options: O,
  page = false,
): EffectHandle<I, E> {
  const ref = useRef<E | null>(null);
  const [instance, setInstance] = useState<I | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const key = optionsKey(options);
  const applied = useRef(key);

  useEffect(() => {
    const element = page ? document.body : ref.current;
    if (!element) return;
    const created = create(element, latest.current);
    applied.current = optionsKey(latest.current);
    setInstance(created);
    return () => {
      created.destroy();
      setInstance(null);
    };
    // Recreated only when it moves between the page and its own element.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  useEffect(() => {
    if (!instance || applied.current === key) return;
    applied.current = key;
    (instance.set as (options: O) => void)(latest.current);
  }, [instance, key]);

  return { ref, instance };
}

/** Props shared by every effect component. Any other prop goes to the rendered element. */
export interface EffectProps<I, O> extends Omit<AllHTMLAttributes<HTMLElement>, 'as'> {
  /** The effect's options. Changing them updates the running effect. */
  options?: O;
  /** Element to render. Default 'div'. */
  as?: string;
  /** Called with the running effect once it has started. */
  onReady?: (instance: I) => void;
  children?: ReactNode;
}

export interface PageProps {
  /**
   * Cover the whole page (`document.body`) instead of a wrapper element.
   * Children render as they are, with no wrapper.
   */
  page?: boolean;
}

/** Builds a component that renders an element and runs an effect on it. */
export function effectComponent<I extends Controllable, O>(
  displayName: string,
  create: (element: HTMLElement, options: O) => I,
): (props: EffectProps<I, O> & PageProps) => ReactElement {
  function Effect({ options, as = 'div', onReady, page = false, children, ...rest }: EffectProps<I, O> & PageProps): ReactElement {
    const { ref, instance } = useElementalEffect<I, O>(create, (options ?? {}) as O, page);
    const ready = useRef(onReady);
    ready.current = onReady;
    useEffect(() => {
      if (instance) ready.current?.(instance);
    }, [instance]);
    if (page) return createElement(Fragment, null, children);
    return createElement(as, { ref, ...rest }, children);
  }
  Effect.displayName = displayName;
  return Effect;
}
