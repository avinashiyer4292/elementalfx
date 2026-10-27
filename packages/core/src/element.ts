import { isBrowser } from './env';

/** How an HTML attribute string is turned into an option value. */
export type AttributeType = 'number' | 'boolean' | 'string' | 'list' | 'json';

export interface AttributeSpec {
  /** Option name the attribute maps to, e.g. `drop-radius` → `dropRadius`. */
  option: string;
  type: AttributeType;
}

/** The minimum surface an effect instance needs for the custom element wrapper. */
export interface ElementControllable {
  set(options: Record<string, unknown>): void;
  destroy(): void;
}

export interface EffectElementSpec<I extends ElementControllable> {
  /** Attribute name → option mapping. */
  attributes: Record<string, AttributeSpec>;
  /** Creates the effect on the host element. */
  create(host: HTMLElement, options: Record<string, unknown>): I;
  /** Inline styles applied to the host if the page hasn't styled it, e.g. `display: block`. */
  hostStyle?: Partial<Record<'display' | 'position', string>>;
}

/** Element interface added to every effect element. */
export interface EffectElement<I> extends HTMLElement {
  /** The running effect, or null while disconnected or before setup. */
  readonly effect: I | null;
}

export function parseAttribute(value: string | null, type: AttributeType): unknown {
  switch (type) {
    case 'boolean':
      return value !== null && value !== 'false';
    case 'number': {
      if (value === null || value.trim() === '') return undefined;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    case 'list':
      return value === null ? undefined : value.split(/[\s,]+/).filter(Boolean);
    case 'json':
      if (value === null) return undefined;
      try {
        return JSON.parse(value) as unknown;
      } catch {
        console.warn(`[elementalfx] Ignoring attribute value that is not valid JSON: ${value}`);
        return undefined;
      }
    default:
      return value ?? undefined;
  }
}

/** Converts `drop-radius` to `dropRadius`. */
export function attributeToOption(name: string): string {
  return name.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

/**
 * Registers a custom element that creates an effect when connected and
 * destroys it when disconnected. Attribute changes become `set()` calls.
 * Returns the element class, or undefined outside the browser (SSR).
 */
export function defineEffectElement<I extends ElementControllable>(
  tagName: string,
  spec: EffectElementSpec<I>,
): CustomElementConstructor | undefined {
  if (!isBrowser || typeof customElements === 'undefined') return undefined;
  const existing = customElements.get(tagName);
  if (existing) return existing;

  const attributeNames = Object.keys(spec.attributes);

  class FxElement extends HTMLElement implements EffectElement<I> {
    static get observedAttributes(): string[] {
      return attributeNames;
    }

    private instance: I | null = null;
    private pendingSetup = false;

    get effect(): I | null {
      return this.instance;
    }

    connectedCallback(): void {
      for (const [property, value] of Object.entries(spec.hostStyle ?? {})) {
        const key = property as 'display' | 'position';
        if (!this.style[key] && getComputedStyle(this)[key] === defaultFor(key)) {
          this.style[key] = value as string;
        }
      }
      // When the element is parsed from HTML its children may not exist yet.
      if (document.readyState === 'loading') {
        if (this.pendingSetup) return;
        this.pendingSetup = true;
        document.addEventListener('DOMContentLoaded', () => this.setup(), { once: true });
      } else {
        this.setup();
      }
    }

    disconnectedCallback(): void {
      this.instance?.destroy();
      this.instance = null;
    }

    attributeChangedCallback(name: string, previous: string | null, next: string | null): void {
      if (!this.instance || previous === next) return;
      const attribute = spec.attributes[name];
      if (!attribute) return;
      this.instance.set({ [attribute.option]: parseAttribute(next, attribute.type) });
    }

    private setup(): void {
      this.pendingSetup = false;
      if (!this.isConnected || this.instance) return;
      const options: Record<string, unknown> = {};
      for (const name of attributeNames) {
        if (!this.hasAttribute(name)) continue;
        const attribute = spec.attributes[name]!;
        const value = parseAttribute(this.getAttribute(name), attribute.type);
        if (value !== undefined) options[attribute.option] = value;
      }
      this.instance = spec.create(this, options);
      this.dispatchEvent(new CustomEvent('fx-ready', { detail: this.instance }));
    }
  }

  customElements.define(tagName, FxElement);
  return FxElement;
}

function defaultFor(property: 'display' | 'position'): string {
  return property === 'display' ? 'inline' : 'static';
}
