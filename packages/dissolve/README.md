# @elementalfx/dissolve

Make any element vanish in style. It can crumble into dust and blow away, burn with a glowing edge, melt down in drips, or fade through noise. `assemble()` brings it back the same way.

It works on cards, text, images, canvas and video. The browser keeps drawing the real element the whole time and an SVG filter masks it, so there's no screenshot that could look slightly off. About 7 KB gzipped.

## Install

```sh
npm install @elementalfx/dissolve
```

## Use

```js
import { dissolve, assemble } from '@elementalfx/dissolve';

await dissolve('#card');                        // crumbles into dust, then is hidden
await assemble('#card');                        // the dust flies back

await dissolve(toast, { effect: 'burn' });      // burns from the bottom up
await dissolve(row, { effect: 'melt', after: 'remove' });
```

Both return a promise that resolves when the animation is over. By default a dissolved element is hidden with `visibility: hidden`, so the layout doesn't jump. Pass `after: 'remove'` to take it out of the page instead.

### Script tag

```html
<script src="https://unpkg.com/@elementalfx/dissolve/dist/dissolve.global.js"></script>
<script>
  ElementalFX.dissolve.dissolve('#card', { effect: 'burn' });
</script>
```

## Effects

| Effect | What happens |
| --- | --- |
| `dust` | The element crumbles from one side into specks in its own colors, which blow away on a breeze (default) |
| `burn` | A glowing edge eats through it, leaving a charred band and sparks |
| `melt` | Each column drips down at its own pace while it fades |
| `fade` | A soft, blotchy fade |

## Options

| Option | Default | Description |
| --- | --- | --- |
| `effect` | `'dust'` | `'dust'`, `'burn'`, `'melt'` or `'fade'` |
| `duration` | 1.6 s | 2.2 s for burn, 1.8 s for melt, 1 s for fade. `0` hides or shows the element at once |
| `direction` | per effect | Which way the edge travels: `'right'`, `'left'`, `'up'`, `'down'` or `'none'` (blotches everywhere at once). Dust defaults to `'right'`, burn to `'up'`, fade to `'none'` |
| `noise` | `0.4` | How ragged the edge is, from 0 (a straight line) to 1 (blotches) |
| `scale` | `36` | Size of the blotches in px |
| `color` | `'#ff7a1a'` | Fire color for `burn` |
| `particles` | `1` | How many dust specks or sparks, as a multiple of the default |
| `grain` | `3` | Size of a dust speck in px |
| `after` | `'hide'` | `'hide'` keeps the element's space; `'remove'` takes it out of the page |
| `seed` | random | Same seed, same pattern |
| `respectReducedMotion` | `true` | A plain quick fade instead when the user prefers reduced motion |

Also exported: `isDissolved(element)`, which is true while `dissolve` has the element hidden.

## How it works

Each run builds a small noise texture that decides which spots vanish first, a sweep in one direction roughened by noise. The element gets an SVG filter that compares that texture against a moving threshold. Burning adds two more thresholds just ahead of the edge: one for a glowing band and one for a charred band. Melting uses a displacement map instead, where each column runs down by its own amount.

The dust needs to know the element's colors. For that, the package takes a small, low-resolution picture of it. Images, canvas and video are drawn directly; anything else is copied into an SVG `<foreignObject>` with its computed styles inlined. That picture only colors the specks, so if a web font or a cross-origin image doesn't make it in, a few specks come out the wrong color and the element itself still looks right. When no picture can be taken, the specks use the element's text and background colors.

Every speck leaves from the exact spot where the element disappears, because the specks and the filter read the same noise texture. `assemble` runs everything backwards: each speck flies in and lands on its spot just as that spot reappears.

Afterwards, the element's style attribute is exactly as it was.

MIT License
