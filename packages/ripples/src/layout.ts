/** Where the image is drawn inside the effect area, in CSS px. */
export interface DrawRect {
  x: number;
  y: number;
  width: number;
  height: number;
  repeatX: boolean;
  repeatY: boolean;
}

/** Extracts the first `url(...)` from a computed background-image value. */
export function firstBackgroundUrl(value: string): string | null {
  const match = /url\(\s*(['"]?)(.*?)\1\s*\)/.exec(value);
  return match ? match[2]! : null;
}

function firstLayer(value: string): string {
  // Commas also appear inside functions, so only split at top level.
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) return value.slice(0, i).trim();
  }
  return value.trim();
}

/** Parses a length or percentage against `basis`. Returns null for 'auto' or anything unparsable. */
function length(token: string | undefined, basis: number): number | null {
  if (!token || token === 'auto') return null;
  if (token.endsWith('%')) return (parseFloat(token) / 100) * basis;
  if (token.endsWith('px')) return parseFloat(token);
  const n = parseFloat(token);
  return Number.isFinite(n) ? n : null;
}

/** Resolves a CSS position component (e.g. "50%", "10px", "left") for an image of `size` in `area`. */
function position(token: string | undefined, area: number, size: number): number {
  if (!token) return (area - size) / 2;
  const keywords: Record<string, number> = { left: 0, top: 0, center: 50, right: 100, bottom: 100 };
  if (token in keywords) return ((area - size) * keywords[token]!) / 100;
  if (token.endsWith('%')) return ((area - size) * parseFloat(token)) / 100;
  const px = parseFloat(token);
  return Number.isFinite(px) ? px : (area - size) / 2;
}

/** Computes where a CSS background image is drawn, following background-size/position/repeat. */
export function backgroundRect(
  style: CSSStyleDeclaration,
  areaWidth: number,
  areaHeight: number,
  imageWidth: number,
  imageHeight: number,
): DrawRect {
  const size = firstLayer(style.backgroundSize || 'auto');
  let width = imageWidth;
  let height = imageHeight;
  if (size === 'cover' || size === 'contain') {
    const scale =
      size === 'cover'
        ? Math.max(areaWidth / imageWidth, areaHeight / imageHeight)
        : Math.min(areaWidth / imageWidth, areaHeight / imageHeight);
    width = imageWidth * scale;
    height = imageHeight * scale;
  } else {
    const [w, h] = size.split(/\s+/);
    const explicitW = length(w, areaWidth);
    const explicitH = length(h ?? 'auto', areaHeight);
    if (explicitW !== null && explicitH !== null) {
      width = explicitW;
      height = explicitH;
    } else if (explicitW !== null) {
      width = explicitW;
      height = (imageHeight / imageWidth) * explicitW;
    } else if (explicitH !== null) {
      height = explicitH;
      width = (imageWidth / imageHeight) * explicitH;
    }
  }
  const x = position(firstLayer(style.backgroundPositionX || '50%'), areaWidth, width);
  const y = position(firstLayer(style.backgroundPositionY || '50%'), areaHeight, height);
  const repeat = firstLayer(style.backgroundRepeat || 'repeat');
  const [repeatX, repeatY] = repeat.split(/\s+/);
  const tiles = (token: string | undefined): boolean => token === 'repeat' || token === 'round' || token === 'space';
  return {
    x,
    y,
    width,
    height,
    repeatX: repeat === 'repeat-x' || (repeat !== 'repeat-y' && tiles(repeatX)),
    repeatY: repeat === 'repeat-y' || (repeat !== 'repeat-x' && tiles(repeatY ?? repeatX)),
  };
}

/** Computes where an `<img>`/`<video>` draws its pixels, following object-fit/object-position. */
export function objectRect(
  style: CSSStyleDeclaration,
  box: { x: number; y: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number,
): DrawRect {
  const fit = style.objectFit || 'fill';
  let width = box.width;
  let height = box.height;
  if (fit !== 'fill') {
    const cover = Math.max(box.width / imageWidth, box.height / imageHeight);
    const contain = Math.min(box.width / imageWidth, box.height / imageHeight);
    const scale =
      fit === 'cover' ? cover : fit === 'contain' ? contain : fit === 'none' ? 1 : Math.min(1, contain);
    width = imageWidth * scale;
    height = imageHeight * scale;
  }
  const [px, py] = (style.objectPosition || '50% 50%').split(/\s+/);
  return {
    x: box.x + position(px, box.width, width),
    y: box.y + position(py ?? '50%', box.height, height),
    width,
    height,
    repeatX: false,
    repeatY: false,
  };
}

/** The content box of an element relative to its border box, in CSS px. */
export function contentBox(
  style: CSSStyleDeclaration,
  borderWidth: number,
  borderHeight: number,
): { x: number; y: number; width: number; height: number } {
  const n = (value: string): number => parseFloat(value) || 0;
  const left = n(style.borderLeftWidth) + n(style.paddingLeft);
  const top = n(style.borderTopWidth) + n(style.paddingTop);
  const right = n(style.borderRightWidth) + n(style.paddingRight);
  const bottom = n(style.borderBottomWidth) + n(style.paddingBottom);
  return {
    x: left,
    y: top,
    width: Math.max(0, borderWidth - left - right),
    height: Math.max(0, borderHeight - top - bottom),
  };
}

/** Saves inline style values so they can be restored exactly on teardown. */
export class StyleStash {
  private saved: Array<[HTMLElement, string, string]> = [];

  set(element: HTMLElement, property: string, value: string): void {
    this.saved.push([element, property, element.style.getPropertyValue(property)]);
    element.style.setProperty(property, value);
  }

  restore(): void {
    for (let i = this.saved.length - 1; i >= 0; i--) {
      const [element, property, value] = this.saved[i]!;
      if (value) element.style.setProperty(property, value);
      else element.style.removeProperty(property);
    }
    this.saved = [];
  }
}
