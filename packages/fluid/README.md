# @elementalfx/fluid

An interactive WebGL fluid simulation for the web: a smoke or ink trail that follows the cursor over your page, a slowly flowing background behind your content, or splashes fired from code.

About 9 KB gzipped including its runtime. Transparent where there's no dye, so your page shows through.

## Install

```sh
npm install @elementalfx/fluid
```

## Use

```js
import { createFluid } from '@elementalfx/fluid';

// A cursor trail over the whole page (pointer-events: none, never blocks clicks).
const trail = createFluid(document.body, { preset: 'smoke' });

// A living background behind a hero section's content.
const hero = createFluid('.hero', { preset: 'neon' });

// Splashes from code, e.g. when a button is clicked.
button.addEventListener('click', (event) => {
  const rect = hero.element.getBoundingClientRect();
  hero.burst(8, { x: event.clientX - rect.left, y: event.clientY - rect.top });
});
```

### HTML element

```js
import '@elementalfx/fluid/element';
```

```html
<!-- Background behind the element's content -->
<fx-fluid preset="ink" style="height: 60vh">
  <h1>Content stays on top</h1>
</fx-fluid>

<!-- Cursor trail over the whole page -->
<fx-fluid page preset="smoke"></fx-fluid>
```

Attributes: `preset`, `mode`, `colors`, `brightness`, `dye-dissipation`, `velocity-dissipation`, `curl`, `splat-radius`, `splat-force`, `ambient`, `shading`, `opacity`, `quality`, `interactive`, `page`.

### Script tag

```html
<script src="https://unpkg.com/@elementalfx/fluid/dist/fluid.global.js"></script>
<script>
  ElementalFX.fluid.createFluid(document.body, { preset: 'ink' });
</script>
```

## Presets

| Preset | Look |
| --- | --- |
| `ink` | Saturated, random hues that linger (default) |
| `smoke` | Soft white smoke that fades quickly; best on dark pages |
| `neon` | Bright cyan, magenta, lime and gold with strong swirls |

## Options

| Option | Default | Description |
| --- | --- | --- |
| `preset` | `'ink'` | Starting values for the options below |
| `mode` | auto | `'cursor'` (page overlay) on `document.body`, `'background'` (behind content) elsewhere |
| `colors` | `'rainbow'` | Hex colors to pick from, or `'rainbow'` |
| `brightness` | `0.2` | Brightness of injected dye |
| `dyeDissipation` | `1` | How fast dye fades, per second |
| `velocityDissipation` | `0.2` | How fast motion fades, per second |
| `pressure` | `0.8` | Fraction of pressure kept between frames |
| `curl` | `30` | Swirl strength |
| `splatRadius` | `0.25` | Splat size relative to the area |
| `splatForce` | `6000` | How hard pointer movement pushes |
| `ambient` | `0` / `1` | Invisible strokes that keep it flowing on their own; 1 by default in background mode |
| `shading` | `1` | Soft 3D shading, 0 to 1 |
| `opacity` | `1` | Maximum opacity |
| `quality` | `'auto'` | `'low'`, `'medium'`, `'high'`, or `'auto'` (by device, stepping down if frames run below ~40 fps) |
| `interactive` | `true` | Pointer movement stirs the fluid |
| `zIndex` | `2147483000` | z-index of the cursor overlay |
| `respectReducedMotion` | `true` | Stay off when the user prefers reduced motion |
| `pauseOffscreen` | `true` | Stop animating out of view |
| `maxPixelRatio` | `2` | Cap on devicePixelRatio |

## Methods

`splat(x, y, dx, dy, color?)`, `burst(count?, at?)`, `set(options)`, `clear()`, `pause()`, `play()`, `destroy()`, plus `ready`, `mode` and `quality`.

## How it works

A grid solver after Jos Stam's *Stable Fluids* (SIGGRAPH 1999) and Mark Harris's *Fast Fluid Dynamics Simulation on the GPU* (GPU Gems, ch. 38), all on the GPU in half-float textures. Each frame it computes curl and adds vorticity confinement, solves for pressure with Jacobi iterations warm-started from the last frame, subtracts the pressure gradient so the flow stays incompressible, then moves velocity and dye along the flow. When nothing has moved for a few seconds it clears and stops drawing.

Inspired by Pavel Dobryakov's [WebGL Fluid Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation) (MIT), whose parameter names and defaults this package follows so they feel familiar. The code here is a fresh implementation on the shared elementalfx WebGL toolkit.

Needs a GPU that can render to half-float textures; elsewhere `ready` resolves to `false` and nothing is drawn.

MIT License
