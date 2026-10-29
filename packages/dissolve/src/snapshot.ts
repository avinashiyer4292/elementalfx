/**
 * A rough, low-resolution picture of an element, one pixel per dust speck,
 * used only to color the specks and to know where the element has ink. The
 * element itself is never replaced by this picture: the browser keeps drawing
 * it, and the SVG filter only masks it. So fonts or details that come out
 * differently here just tint a few specks.
 */
export interface Snapshot {
  columns: number;
  rows: number;
  /** RGBA, row by row. */
  data: Uint8ClampedArray;
}

const XHTML = 'http://www.w3.org/1999/xhtml';
const MAX_ELEMENTS = 800;
const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED']);

function read(source: CanvasImageSource, columns: number, rows: number): Snapshot | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = columns;
    canvas.height = rows;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(source, 0, 0, columns, rows);
    return { columns, rows, data: ctx.getImageData(0, 0, columns, rows).data };
  } catch {
    // Cross-origin media taints the canvas.
    return null;
  }
}

/** A data URL for an image, canvas or video frame, or '' if it can't be read. */
function inline(source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement, width: number, height: number): string {
  try {
    if (source instanceof HTMLCanvasElement) return source.toDataURL();
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 256 / Math.max(width, height, 1));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL();
  } catch {
    return '';
  }
}

function styleText(element: Element): string {
  const computed = getComputedStyle(element);
  let text = '';
  for (let i = 0; i < computed.length; i++) {
    const name = computed[i]!;
    text += `${name}:${computed.getPropertyValue(name)};`;
  }
  return text;
}

function cloneStyled(source: Element, budget: { left: number }): Element | null {
  if (--budget.left < 0) return null;
  const tag = source.tagName.toUpperCase();
  if (source instanceof SVGElement) return source.cloneNode(true) as Element;
  if (source instanceof HTMLImageElement || source instanceof HTMLCanvasElement || source instanceof HTMLVideoElement) {
    const image = document.createElementNS(XHTML, 'img') as HTMLImageElement;
    image.setAttribute('style', styleText(source));
    image.setAttribute('src', inline(source, source.offsetWidth, source.offsetHeight));
    return image;
  }
  const clone = document.createElementNS(XHTML, source.localName) as HTMLElement;
  clone.setAttribute('style', styleText(source));
  if (source instanceof HTMLInputElement || source instanceof HTMLTextAreaElement) clone.setAttribute('value', source.value);
  for (const child of source.childNodes) {
    if (child.nodeType === 3) clone.append(child.textContent ?? '');
    else if (child.nodeType === 1 && !SKIP.has((child as Element).tagName.toUpperCase())) {
      const copy = cloneStyled(child as Element, budget);
      if (!copy) return null;
      clone.append(copy);
    }
  }
  if (tag === 'TEXTAREA') clone.textContent = (source as HTMLTextAreaElement).value;
  return clone;
}

function load(url: string, timeout: number): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    const timer = setTimeout(() => resolve(null), timeout);
    image.onload = () => {
      clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    image.src = url;
  });
}

/**
 * Pictures `element` at `columns` × `rows`. Images, canvases and video are
 * drawn directly; anything else goes through an SVG <foreignObject> with
 * every computed style inlined. Resolves null when it can't (cross-origin
 * media, a huge subtree, or a browser that refuses).
 */
export async function snapshot(element: Element, width: number, height: number, columns: number, rows: number): Promise<Snapshot | null> {
  if (element instanceof HTMLImageElement) {
    if (!element.complete || element.naturalWidth === 0) return null;
    return read(element, columns, rows);
  }
  if (element instanceof HTMLCanvasElement || element instanceof HTMLVideoElement) return read(element, columns, rows);

  const clone = cloneStyled(element, { left: MAX_ELEMENTS }) as (Element & ElementCSSInlineStyle) | null;
  if (!clone) return null;
  // Place the copy at the origin as an untransformed, fully visible box.
  clone.style.setProperty('margin', '0');
  clone.style.setProperty('position', 'static');
  clone.style.setProperty('transform', 'none');
  clone.style.setProperty('filter', 'none');
  clone.style.setProperty('opacity', '1');
  clone.style.setProperty('visibility', 'visible');
  clone.style.setProperty('width', `${width}px`);
  clone.style.setProperty('height', `${height}px`);
  clone.style.setProperty('box-sizing', 'border-box');
  const markup = new XMLSerializer().serializeToString(clone);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject x="0" y="0" width="100%" height="100%">${markup}</foreignObject></svg>`;
  const image = await load(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, 1500);
  return image ? read(image, columns, rows) : null;
}
