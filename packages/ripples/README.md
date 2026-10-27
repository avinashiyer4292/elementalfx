# @elementalfx/ripples

WebGL water ripples for images, video and CSS backgrounds. Move the pointer over the element and the picture ripples like water.

A modern, dependency-free replacement for [jquery.ripples](https://github.com/sirxemic/jquery.ripples): no jQuery, works on `<img>` and `<video>`, falls back gracefully on devices without float textures, respects reduced-motion settings, and stops drawing when idle. About 10 KB gzipped including its runtime.

## Install

```sh
npm install @elementalfx/ripples
```

## Use

### JavaScript

```js
import { createRipples } from '@elementalfx/ripples';

// An element with a CSS background image, an element containing an <img> or
// <video>, or an <img>/<video> element itself.
const ripples = createRipples('.hero', { preset: 'pond', dropRadius: 24 });

ripples.drop(200, 120, 30, 0.2); // x, y in CSS px; radius; strength
ripples.set({ perturbance: 0.05 });
ripples.destroy(); // removes everything and restores the element
```

### HTML element

```js
import '@elementalfx/ripples/element';
```

```html
<fx-ripples preset="rain" drop-radius="18">
  <img src="lake.jpg" alt="A lake at dusk" />
  <h1>Text stays on top and selectable</h1>
</fx-ripples>
```

Attributes: `preset`, `src`, `resolution`, `drop-radius`, `perturbance`, `damping`, `highlight`, `interactive`, `rain`, `idle-timeout`. The running effect is available as `element.effect`.

### Script tag

```html
<script src="https://unpkg.com/@elementalfx/ripples/dist/ripples.global.js"></script>
<script>
  ElementalFX.ripples.createRipples(document.body);
</script>
```

The script registers `<fx-ripples>` too.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `preset` | `'pond'` | Starting values: `'pond'`, `'rain'` (continuous drops) or `'subtle'` (gentle refraction) |
| `source` | auto | Image URL or `HTMLImageElement`/`HTMLVideoElement`/`HTMLCanvasElement`/`ImageBitmap`. By default the element's background image, else its first `<img>`/`<video>` |
| `fit` | `'cover'` | How an explicit `source` fills the element: `'cover'`, `'contain'` or `'fill'` |
| `resolution` | `256` | Simulation cells along the longer side |
| `dropRadius` | `20` | Radius in CSS px of pointer drops |
| `perturbance` | `0.03` | Refraction strength, as a fraction of the element width |
| `damping` | `0.995` | Wave energy kept per step (60 steps per second) |
| `highlight` | `0.5` | Brightness of highlights on wave slopes, 0 to 1 |
| `interactive` | `true` | Pointer movement and clicks make ripples |
| `rain` | `false` | `true` or `{ rate, radius: [min, max], strength: [min, max] }` for continuous drops |
| `crossOrigin` | `'anonymous'` | Used when loading image URLs |
| `respectReducedMotion` | `true` | Stay off when the user prefers reduced motion |
| `pauseOffscreen` | `true` | Stop animating when scrolled out of view |
| `maxPixelRatio` | `2` | Cap on devicePixelRatio for the canvas size |
| `idleTimeout` | `12` | Seconds without drops before the water settles and drawing stops |

## Methods

| Method | Description |
| --- | --- |
| `drop(x, y, radius?, strength?)` | Adds a drop at CSS px coordinates relative to the effect area |
| `set(options)` | Updates options; a new `source` reloads the image |
| `pause()`, `play()` | Freeze or resume the simulation |
| `hide()`, `show()` | Remove the effect visually (the original shows) and put it back |
| `updateSize()` | Re-measure; called automatically on resize |
| `destroy()` | Remove the effect and restore the element exactly |
| `ready` | Promise resolving to `true` once drawing, `false` if the effect can't run |
| `isSupported()` | Exported function: whether WebGL2 is available |

## Migrating from jquery.ripples

| jquery.ripples | @elementalfx/ripples |
| --- | --- |
| `$(el).ripples({ resolution, dropRadius, perturbance, interactive, crossOrigin })` | `createRipples(el, { resolution, dropRadius, perturbance, interactive, crossOrigin })` |
| `$(el).ripples('drop', x, y, radius, strength)` | `ripples.drop(x, y, radius, strength)` |
| `$(el).ripples('set', name, value)` | `ripples.set({ [name]: value })` |
| `'pause'`, `'play'`, `'hide'`, `'show'`, `'updateSize'`, `'destroy'` | Methods with the same names |
| `imageUrl` option | `source` option |

Differences: no jQuery; `<img>` and `<video>` sources; WebGL2 with an 8-bit fallback instead of requiring `OES_texture_float`; ripples spread at the same speed on 60 Hz and 120 Hz screens.

## How it works

Two textures hold water height and velocity. Each step a shader moves every cell's velocity toward the average height of its neighbours (the discrete wave equation), damps it, and updates the height; the textures then swap roles. The render pass turns the height slope into a surface normal, shifts the image lookup by it to fake refraction, and adds a soft highlight. Steps run at a fixed 60 per second regardless of the display's refresh rate.

## Notes

- Cross-origin images need CORS headers (`Access-Control-Allow-Origin`). Same-origin and `data:` images always work.
- On `document.body`, the effect covers the viewport like `background-attachment: fixed`.
- Each effect uses one WebGL context; browsers allow about 16 per page.

MIT License
