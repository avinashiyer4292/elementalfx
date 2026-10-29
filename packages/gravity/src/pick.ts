import type { GravitySplit } from './options';

// Never fall, and nothing inside them does.
const SKIP = new Set([
  'SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'HEAD', 'META', 'LINK', 'TITLE', 'BR', 'WBR',
  'SOURCE', 'TRACK', 'PARAM', 'AREA', 'MAP', 'OPTION', 'OPTGROUP', 'DATALIST', 'DIALOG',
]);
// Fall as one piece; their insides are never split.
const ATOMIC = new Set([
  'IMG', 'SVG', 'VIDEO', 'AUDIO', 'CANVAS', 'PICTURE', 'IFRAME', 'OBJECT', 'EMBED', 'BUTTON',
  'INPUT', 'SELECT', 'TEXTAREA', 'HR', 'METER', 'PROGRESS', 'MATH',
]);
const ATOMIC_SELECTOR = 'img,svg,video,audio,canvas,picture,iframe,object,embed,button,input,select,textarea,hr,meter,progress,math';

const tag = (element: Element): string => element.tagName.toUpperCase();
const marked = (element: Element, value: string): boolean => element.getAttribute('data-gravity') === value;

function hasDirectText(element: Element): boolean {
  for (const node of element.childNodes) {
    if (node.nodeType === 3 && /\S/.test((node as Text).data)) return true;
  }
  return false;
}

function paints(style: CSSStyleDeclaration): boolean {
  return (
    (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent') ||
    style.backgroundImage !== 'none' ||
    parseFloat(style.borderTopWidth) + parseFloat(style.borderLeftWidth) > 0 ||
    style.boxShadow !== 'none'
  );
}

/**
 * Finds the elements that fall: the smallest ones that show text or media, so
 * a paragraph falls as one piece while the section around it stays put.
 */
export function pickElements(root: Element, selector: string | null, onlyVisible: boolean, max: number): Element[] {
  const viewportW = document.documentElement.clientWidth;
  const viewportH = document.documentElement.clientHeight;
  const big = viewportW * viewportH * 0.6;
  const picked: Element[] = [];

  const visible = (rect: DOMRect): boolean =>
    !onlyVisible || (rect.bottom > 0 && rect.right > 0 && rect.top < viewportH && rect.left < viewportW);

  if (selector) {
    const candidates = [...root.querySelectorAll(selector)].filter((element) => {
      if (element.closest('[data-gravity="ignore"]') || element.closest('[data-fx]')) return false;
      const rect = element.getBoundingClientRect();
      return rect.width >= 1 && rect.height >= 1 && visible(rect);
    });
    // Nested matches would collide with each other: keep the innermost.
    const inner = candidates.filter((element) => !candidates.some((other) => other !== element && element.contains(other)));
    return inner.slice(0, max);
  }

  const walk = (element: Element): void => {
    if (picked.length >= max) return;
    if (SKIP.has(tag(element)) || marked(element, 'ignore') || element.hasAttribute('data-fx')) return;
    const style = getComputedStyle(element);
    if (style.display === 'none') return;
    const children = (): void => {
      for (const child of element.children) walk(child);
    };
    if (style.display === 'contents') return children();
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1 || style.visibility !== 'visible') return children();
    if (!visible(rect)) return;
    if (marked(element, 'body') || ATOMIC.has(tag(element))) {
      picked.push(element);
      return;
    }
    // A card, badge or chip: a small painted box falls with everything in it.
    if (rect.width < viewportW * 0.6 && rect.width * rect.height < big * 0.4 && paints(style) && element.textContent?.trim()) {
      picked.push(element);
      return;
    }
    if (hasDirectText(element)) {
      // A huge block of text with structure inside is better split up.
      if (rect.width * rect.height > big && element.children.length > 0) return children();
      picked.push(element);
      return;
    }
    if (element.children.length === 0) {
      if (paints(style)) picked.push(element);
      return;
    }
    children();
  };

  for (const child of root.children) walk(child);
  return picked;
}

const segmenter: { segment(input: string): Iterable<{ segment: string }> } | null =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new (Intl as unknown as { Segmenter: new (locale?: string, options?: object) => { segment(input: string): Iterable<{ segment: string }> } }).Segmenter(undefined, { granularity: 'grapheme' })
    : null;

function graphemes(text: string): string[] {
  return segmenter ? Array.from(segmenter.segment(text), (part) => part.segment) : Array.from(text);
}

function piece(text: string, nowrap = false): HTMLSpanElement {
  const span = document.createElement('span');
  span.setAttribute('data-gravity-piece', '');
  span.style.display = 'inline-block';
  if (nowrap) span.style.whiteSpace = 'nowrap';
  span.textContent = text;
  return span;
}

export interface SplitResult {
  /** Elements that fall: word or letter spans, plus media inside the split elements. */
  bodies: Element[];
  /** Puts the original text nodes back. */
  undo(): void;
}

/**
 * Wraps every word (or letter) of text inside `elements` in an inline-block
 * span so each can fall on its own. Media and form controls inside fall whole.
 */
export function splitText(elements: Element[], mode: Exclude<GravitySplit, false>, max: number): SplitResult {
  const replaced: { text: Text; nodes: Node[] }[] = [];
  const bodies: Element[] = [];

  for (const element of elements) {
    if (bodies.length >= max) break;
    if (ATOMIC.has(tag(element)) || marked(element, 'body')) {
      bodies.push(element);
      continue;
    }
    const texts: Text[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!/\S/.test((node as Text).data)) return NodeFilter.FILTER_REJECT;
        for (let parent = node.parentElement; parent && parent !== element; parent = parent.parentElement) {
          if (SKIP.has(tag(parent)) || ATOMIC.has(tag(parent)) || marked(parent, 'ignore') || marked(parent, 'body')) {
            return NodeFilter.FILTER_REJECT;
          }
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text);

    const before = bodies.length;
    for (const text of texts) {
      const nodes: Node[] = [];
      for (const token of text.data.split(/(\s+)/)) {
        if (!token) continue;
        if (/^\s+$/.test(token) || bodies.length >= max) {
          nodes.push(document.createTextNode(token));
        } else if (mode === 'words') {
          const span = piece(token);
          nodes.push(span);
          bodies.push(span);
        } else {
          // Letters sit in an unbreakable word so lines wrap as before.
          const word = document.createElement('span');
          word.style.display = 'inline-block';
          word.style.whiteSpace = 'nowrap';
          for (const letter of graphemes(token)) {
            const span = piece(letter);
            word.append(span);
            bodies.push(span);
          }
          nodes.push(word);
        }
      }
      text.replaceWith(...nodes);
      replaced.push({ text, nodes });
    }

    for (const inner of element.querySelectorAll(ATOMIC_SELECTOR)) {
      // Only the outermost: an icon inside a button falls with the button.
      const outer = inner.parentElement?.closest(ATOMIC_SELECTOR);
      if ((!outer || !element.contains(outer)) && !inner.closest('[data-gravity="ignore"]')) bodies.push(inner);
    }
    // Nothing to split (an empty box, say): it falls whole.
    if (bodies.length === before) bodies.push(element);
  }

  return {
    bodies: bodies.slice(0, max),
    undo() {
      for (const { text, nodes } of replaced.reverse()) {
        const first = nodes[0];
        if (first?.parentNode) first.parentNode.insertBefore(text, first);
        for (const node of nodes) node.parentNode?.removeChild(node);
      }
      replaced.length = 0;
    },
  };
}
