export type GravityWalls = 'viewport' | 'root';
export type GravitySplit = false | 'words' | 'letters';

/**
 * When the page falls by itself:
 * - 'manual': only when you call `drop()` (default)
 * - 'load': as soon as the effect is created
 * - 'konami': ↑ ↑ ↓ ↓ ← → ← → B A toggles it
 * - `{ idle: seconds }`: after the visitor does nothing for that long
 * - `{ click: element or selector }`: when that element is clicked
 */
export type GravityTrigger = 'manual' | 'load' | 'konami' | { idle: number } | { click: Element | string };

export interface GravityOptions {
  /**
   * Which elements fall. By default the smallest elements that hold text or
   * media (paragraphs, headings, list items, images, buttons…). Give a CSS
   * selector to choose them yourself. Elements marked `data-gravity="ignore"`
   * never fall, and `data-gravity="body"` falls as one piece.
   */
  selector?: string | null;
  /** Split text into words or letters that fall one by one. Default false. */
  splitText?: GravitySplit;
  /** Downward acceleration in px/s². Default 2000. */
  gravity?: number;
  /** How bouncy elements are, 0 to 1. Default 0.25. */
  bounce?: number;
  /** Surface friction, 0 to 1. Default 0.5. */
  friction?: number;
  /** Random spin added as elements start to fall, in rad/s. Default 0.6. */
  spin?: number;
  /**
   * Where elements land: the bottom of the visible 'viewport', or the edges of
   * the 'root' element. Defaults to 'viewport' for the page, 'root' otherwise.
   */
  walls?: GravityWalls | null;
  /** Only elements on screen when it drops fall. Default true. */
  onlyVisible?: boolean;
  /** Most elements that fall at once. Default 400. */
  maxBodies?: number;
  /** Drag and throw fallen elements with the mouse or a finger. Default true. */
  interactive?: boolean;
  /** When the page falls by itself. Default 'manual'. */
  trigger?: GravityTrigger;
  /** Escape puts everything back. Default true. */
  restoreOnEscape?: boolean;
  /** Seconds the trip back into place takes. Default 0.9. */
  restoreDuration?: number;
  /** Do nothing when the user prefers reduced motion. Default true. */
  respectReducedMotion?: boolean;
}

export type ResolvedGravityOptions = Required<Omit<GravityOptions, 'selector' | 'walls'>> & {
  selector: string | null;
  walls: GravityWalls | null;
};

export const defaults: ResolvedGravityOptions = {
  selector: null,
  splitText: false,
  gravity: 2000,
  bounce: 0.25,
  friction: 0.5,
  spin: 0.6,
  walls: null,
  onlyVisible: true,
  maxBodies: 400,
  interactive: true,
  trigger: 'manual',
  restoreOnEscape: true,
  restoreDuration: 0.9,
  respectReducedMotion: true,
};

export function resolveOptions(options: GravityOptions, base: ResolvedGravityOptions = defaults): ResolvedGravityOptions {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(options)) if (value !== undefined) merged[key] = value;
  // Strings straight from HTML attributes, e.g. trigger="idle 30" or split-text="none".
  if (typeof merged.trigger === 'string') merged.trigger = parseTrigger(merged.trigger);
  if (merged.splitText !== 'words' && merged.splitText !== 'letters') merged.splitText = false;
  return merged as ResolvedGravityOptions;
}

/** Reads a trigger from an attribute: `load`, `konami`, `idle 30` or `click #button`. */
export function parseTrigger(value: string): GravityTrigger {
  const [kind = 'manual', ...rest] = value.trim().split(/\s+/);
  const argument = rest.join(' ');
  if (kind === 'idle') {
    const seconds = Number(argument);
    return { idle: Number.isFinite(seconds) && seconds > 0 ? seconds : 30 };
  }
  if (kind === 'click' && argument) return { click: argument };
  if (kind === 'load' || kind === 'konami') return kind;
  return 'manual';
}
