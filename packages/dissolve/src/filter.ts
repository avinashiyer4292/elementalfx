import type { DissolveEffect } from './options';

const SVG = 'http://www.w3.org/2000/svg';
let defs: SVGDefsElement | null = null;
let count = 0;

/** A hidden <svg> that holds the filters. It can't be display: none, or browsers ignore its filters. */
function container(): SVGDefsElement {
  if (defs?.isConnected) return defs;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('data-fx', 'dissolve');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  defs = document.createElementNS(SVG, 'defs');
  svg.append(defs);
  document.body.append(svg);
  return defs;
}

function node(parent: Element, name: string, attributes: Record<string, string | number>): SVGElement {
  const element = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
    // Older Safari only reads the xlink form.
    if (key === 'href') element.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', String(value));
  }
  parent.append(element);
  return element;
}

/** Alpha = clamp(slope × mask − slope × threshold), as a component transfer. */
function threshold(filter: Element, input: string, result: string, slope: number): SVGElement {
  const transfer = node(filter, 'feComponentTransfer', { in: input, result });
  return node(transfer, 'feFuncA', { type: 'linear', slope, intercept: 0 });
}

export interface DissolveFilter {
  /** Use as `filter: url(#id)`. */
  readonly id: string;
  /** Where the vanishing edge is, in mask units: below 0 shows everything, past 1 hides everything. */
  readonly start: number;
  readonly end: number;
  set(edge: number): void;
  /** For melting: how far content has run (px) and how opaque it still is. */
  melt(distance: number, opacity: number): void;
  destroy(): void;
}

export interface FilterSetup {
  effect: DissolveEffect;
  width: number;
  height: number;
  mask: string;
  drip?: string;
  /** How far below the element melted content can run, as a multiple of its height. */
  reach?: number;
  color: string;
}

/**
 * Builds the SVG filter that does the vanishing. The mask image is compared
 * against a moving threshold with steep linear transfer functions; burning
 * adds a glowing band and a charred band just ahead of the edge.
 */
export function createFilter(setup: FilterSetup): DissolveFilter {
  const { effect, width, height } = setup;
  const id = `fx-dissolve-${++count}`;
  const pad = Math.ceil(Math.max(width, height) * 0.1) + 8;
  const reach = setup.reach ?? 1;
  const filter = node(container(), 'filter', {
    id,
    filterUnits: 'userSpaceOnUse',
    primitiveUnits: 'userSpaceOnUse',
    x: -pad,
    y: -pad,
    width: width + pad * 2,
    height: (effect === 'melt' ? height * reach : height) + pad * 2,
    'color-interpolation-filters': 'sRGB',
  });

  const softness = effect === 'fade' ? 0.12 : 0.02;
  const slope = 1 / softness;
  const band = 0.045;
  const funcs: { func: SVGElement; offset: number }[] = [];
  let displace: SVGElement | null = null;
  let fade: SVGElement | null = null;

  if (effect === 'melt') {
    node(filter, 'feImage', { href: setup.drip!, x: 0, y: 0, width, height: height * reach, preserveAspectRatio: 'none', result: 'drip' });
    displace = node(filter, 'feDisplacementMap', { in: 'SourceGraphic', in2: 'drip', scale: 0, xChannelSelector: 'R', yChannelSelector: 'G', result: 'moved' });
    // Outside the drip map the displacement is meaningless; keep only the element's own columns.
    node(filter, 'feFlood', { 'flood-color': '#fff', x: 0, y: 0, width, height: height * reach, result: 'columns' });
    node(filter, 'feComposite', { in: 'moved', in2: 'columns', operator: 'in', result: 'melted' });
    const transfer = node(filter, 'feComponentTransfer', { in: 'melted' });
    fade = node(transfer, 'feFuncA', { type: 'linear', slope: 1, intercept: 0 });
  } else {
    node(filter, 'feImage', { href: setup.mask, x: 0, y: 0, width, height, preserveAspectRatio: 'none', result: 'mask' });
    funcs.push({ func: threshold(filter, 'mask', 'alive', slope), offset: 0 });
    if (effect === 'burn') {
      funcs.push({ func: threshold(filter, 'mask', 'inner', slope), offset: band });
      funcs.push({ func: threshold(filter, 'mask', 'core', slope), offset: band * 2.5 });
      node(filter, 'feComposite', { in: 'alive', in2: 'inner', operator: 'out', result: 'hotBand' });
      node(filter, 'feComposite', { in: 'inner', in2: 'core', operator: 'out', result: 'charBand' });
      node(filter, 'feComposite', { in: 'SourceGraphic', in2: 'core', operator: 'in', result: 'intact' });
      node(filter, 'feColorMatrix', {
        in: 'SourceGraphic',
        type: 'matrix',
        values: '0.25 0 0 0 0.04  0 0.18 0 0 0.02  0 0 0.14 0 0.01  0 0 0 1 0',
        result: 'dark',
      });
      node(filter, 'feComposite', { in: 'dark', in2: 'charBand', operator: 'in', result: 'charred' });
      node(filter, 'feFlood', { 'flood-color': setup.color, result: 'flame' });
      node(filter, 'feComposite', { in: 'flame', in2: 'hotBand', operator: 'in', result: 'hot0' });
      node(filter, 'feComposite', { in: 'hot0', in2: 'SourceAlpha', operator: 'in', result: 'hot' });
      node(filter, 'feGaussianBlur', { in: 'hot', stdDeviation: 3, result: 'glow' });
      const merge = node(filter, 'feMerge', {});
      for (const input of ['glow', 'intact', 'charred', 'hot']) node(merge, 'feMergeNode', { in: input });
    } else {
      node(filter, 'feComposite', { in: 'SourceGraphic', in2: 'alive', operator: 'in' });
    }
  }

  const start = effect === 'burn' ? -(band * 2.5 + softness) : -softness;
  const end = 1 + softness;

  return {
    id,
    start,
    end,
    set(edge) {
      for (const { func, offset } of funcs) func.setAttribute('intercept', String(-slope * (edge + offset)));
    },
    melt(distance, opacity) {
      displace?.setAttribute('scale', String(distance * 2));
      fade?.setAttribute('slope', String(opacity));
    },
    destroy() {
      filter.remove();
    },
  };
}
