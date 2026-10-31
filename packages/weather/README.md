# @elementalfx/weather

Rain, snow, fog, lightning, falling leaves and embers for any page or element. Every effect follows one shared wind, so rain slants, snow drifts and embers blow the same way, and pointer movement stirs them all. Snow can pile up on your own elements.

About 15 KB gzipped including its runtime. WebGL2 with a Canvas 2D fallback.

## Install

```sh
npm install @elementalfx/weather
```

## Use

```js
import { createWeather } from '@elementalfx/weather';

// The whole page, with snow collecting on headings and cards.
const sky = createWeather(document.body, {
  preset: 'snow',
  settleOn: 'h1, .card',
  wind: { direction: 20, speed: 0.3 },
});

sky.add('fog');
sky.set({ wind: { speed: 0.6, gusts: 0.7 } });
sky.strike(); // a lightning strike, now
sky.remove('snow'); // falling flakes finish; settled snow melts
sky.destroy();
```

### HTML element

```js
import '@elementalfx/weather/element';
```

```html
<!-- Over the whole page -->
<fx-weather page preset="storm" settle-on=".card"></fx-weather>

<!-- Over one section -->
<section class="hero" style="position: relative">
  <fx-weather effects="leaves" wind-speed="0.3" style="position: absolute; inset: 0"></fx-weather>
  ...
</section>
```

Attributes: `page`, `preset`, `effects`, `intensity`, `wind-direction`, `wind-speed`, `wind-gusts`, `wind-turbulence`, `settle-on`, `max-snow-depth`, `settle-speed`, `lightning-rate`, `fog-density`, `layer`, `seed`.

### Script tag

```html
<script src="https://unpkg.com/@elementalfx/weather/dist/weather.global.js"></script>
<script>
  ElementalFX.weather.createWeather(document.body, { preset: 'light-snow' });
</script>
```

### Rain on water

Pass any object with `element` and `drop(x, y, radius, strength)`, such as an [`@elementalfx/ripples`](../ripples) instance, and rain landing on it makes ripples:

```js
const lake = createRipples('.lake');
createWeather(document.body, { preset: 'rain', ripples: [lake] });
```

## Effects and presets

| Effect | What you see |
| --- | --- |
| `snow` | Flakes at several depths that sway and drift; near ones settle on `settleOn` elements |
| `rain` | Slanted streaks with splashes where they land |
| `fog` | Drifting layers that thin around the pointer |
| `lightning` | Branching bolts and a sky flash, never more than three flashes a second |
| `leaves` | Tumbling, flipping autumn leaves |
| `embers` | Rising, flickering sparks |

| Preset | Effects |
| --- | --- |
| `light-snow`, `snow` | snow |
| `blizzard` | heavy snow, fog, strong gusty wind |
| `drizzle`, `rain` | rain |
| `storm` | heavy rain, low fog, lightning, wind |
| `autumn` | leaves in a gusty breeze |
| `fireplace` | embers |
| `mist` | fog |

## Options

| Option | Default | Description |
| --- | --- | --- |
| `preset` | none | Starting effects and settings |
| `effects` | from preset | Array or space-separated string of effects |
| `wind` | `{ direction: 0, speed: 0.15, gusts: 0.3, turbulence: 0.3, pointer: 0.5 }` | Direction in degrees (0 blows left to right, 90 down), speed 0 to 1 (1 ≈ 500 px/s), gusts, swirl and pointer push, each 0 to 1 |
| `intensity` | `1` | Multiplies every particle count |
| `snow`, `rain`, `leaves`, `embers` | | `{ density, size: [min, max], speed, opacity: [min, max], colors }`; rain also takes `splashes` |
| `fog` | `{ density: 0.5, color, height: 1, pointerRadius: 140 }` | Height is the fraction of the area, from the bottom, that fog fills |
| `lightning` | `{ rate: 4, flash: 0.35, color }` | Average strikes per minute and flash brightness |
| `settleOn` | none | Selector or elements whose top edges collect snow and splash rain (up to 32) |
| `maxSnowDepth` | `14` | Tallest snow cap in CSS px |
| `settleSpeed` | `1` | How fast landed snow piles up, as a multiple of what really lands; raise it to cover a headline in seconds |
| `ripples` | `[]` | Drop targets rain makes ripple |
| `layer` | `'front'` | `'back'` draws behind the element's content |
| `zIndex` | `2147483000` | z-index of the page overlay |
| `respectReducedMotion` | `true` | Stay off when the user prefers reduced motion |
| `pauseOffscreen` | `true` | Stop animating out of view |
| `maxPixelRatio` | `2` | Cap on devicePixelRatio |
| `seed` | random | Reproducible particle layouts |

## Methods

`add(effect)`, `remove(effect)`, `set(options)`, `strike(x?)`, `clearSnow()`, `pause()`, `play()`, `destroy()`, `stats()`, plus `ready`, `renderer` and `wind` (the shared `WindField`, which other effects can sample).

## Accessibility

- With `prefers-reduced-motion: reduce` the overlay stays off unless you opt out.
- Lightning is capped at three flashes in any second (WCAG 2.3.1). Keep `lightning.flash` modest on pages with a lot of white.
- The overlay never takes pointer events, so everything underneath stays clickable and selectable.
- Weather is decoration: keep densities low over long-form text, or use `layer: 'back'`.

## How it works

Particles are simulated on the CPU and drawn with one instanced WebGL2 draw call per blend mode. The wind is base wind, slow gusts, curl-noise swirl cached on a 64 px grid, and decaying pushes from pointer movement. Snow caps are a height map per element in 4 px cells that slump when steeper than about 17° and melt when the snow stops. Fog is two layers of fractal noise drifting with the wind. The Canvas 2D fallback draws everything except fog.

MIT License
