# @elementalfx/gravity

Gravity for any web page. Headings, paragraphs, images, buttons and cards come loose, fall, tumble and pile up at the bottom of the screen. Visitors can grab them and throw them around, and Escape flies everything back into place.

Good for 404 pages, Easter eggs and launch-day fun. About 11 KB gzipped, physics engine included, with no dependencies beyond the shared elementalfx runtime.

## Install

```sh
npm install @elementalfx/gravity
```

## Use

```js
import { createGravity } from '@elementalfx/gravity';

const gravity = createGravity(); // the whole page

button.addEventListener('click', () => gravity.drop());
// Later: gravity.restore(), or the visitor presses Escape.
```

Let the page fall on its own:

```js
createGravity(document.body, { trigger: 'konami' });        // ↑ ↑ ↓ ↓ ← → ← → B A
createGravity(document.body, { trigger: { idle: 60 } });    // after a minute of nothing
createGravity(document.body, { trigger: 'load' });          // straight away (a 404 page?)
createGravity(document.body, { trigger: { click: '#gravity-button' } });
```

Make words or letters fall one by one:

```js
createGravity('.hero', { splitText: 'words' }).drop();
```

### HTML element

```js
import '@elementalfx/gravity/element';
```

```html
<!-- Only this box's contents fall, and they land inside it -->
<fx-gravity trigger="click #shake" style="height: 400px">
  <h2>Nothing is nailed down</h2>
  <button id="shake">Shake it</button>
</fx-gravity>

<!-- The whole page, on the Konami code -->
<fx-gravity page trigger="konami"></fx-gravity>
```

Attributes: `selector`, `split-text`, `gravity`, `bounce`, `friction`, `spin`, `walls`, `only-visible`, `max-bodies`, `interactive`, `trigger` (`load`, `konami`, `idle 30`, `click #button`), `restore-on-escape`, `restore-duration`, `page`.

### Script tag

```html
<script src="https://unpkg.com/@elementalfx/gravity/dist/gravity.global.js"></script>
<script>
  ElementalFX.gravity.createGravity(document.body, { trigger: 'konami' });
</script>
```

## What falls

By default, the smallest elements that show something: paragraphs, headings, list items, links, images, video, canvas, SVG, buttons and form fields. Small painted boxes, such as cards, badges and chips, fall whole with everything inside them. The sections and wrappers around them stay put.

- Pass `selector` to choose the elements yourself.
- Put `data-gravity="ignore"` on anything that should stay where it is, along with everything inside it.
- Put `data-gravity="body"` on anything that should fall as one piece.

Only elements on screen when the page drops will fall, unless you set `onlyVisible: false`.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `selector` | auto | CSS selector for the elements that fall |
| `splitText` | `false` | `'words'` or `'letters'` to drop text piece by piece |
| `gravity` | `2000` | Downward acceleration in px/s² |
| `bounce` | `0.25` | How bouncy elements are, 0 to 1 |
| `friction` | `0.5` | Surface friction, 0 to 1 |
| `spin` | `0.6` | Random spin as elements start to fall, in rad/s |
| `walls` | auto | Where elements land: `'viewport'` (the bottom of the screen; the default for the page) or `'root'` (the target's box; the default for other elements) |
| `onlyVisible` | `true` | Only elements on screen fall |
| `maxBodies` | `400` | Most elements that fall at once |
| `interactive` | `true` | Drag and throw fallen elements with a mouse or finger |
| `trigger` | `'manual'` | `'load'`, `'konami'`, `{ idle: seconds }` or `{ click: selector }` |
| `restoreOnEscape` | `true` | Escape puts everything back |
| `restoreDuration` | `0.9` | Seconds the trip back takes |
| `respectReducedMotion` | `true` | Do nothing when the user prefers reduced motion |

## Methods

| Method | Description |
| --- | --- |
| `drop()` | Let everything fall. Resolves once it all rests. |
| `restore()` | Fly everything back. Resolves when the page is exactly as it was. |
| `toggle()` | Drop or restore. |
| `explode(at?, strength?)` | Blow everything apart from a point in viewport px (the middle by default). |
| `set(options)` | Change options. Physics options apply straight away. |
| `destroy()` | Put everything back at once and stop listening. |

Also available: `state` (`'idle'`, `'falling'` or `'restoring'`) and `bodies` (how many elements are falling).

## How it works

Nothing is moved out of the page. Each falling element keeps its place in the layout and moves with a CSS `transform`, so the page never reflows. `restore()` removes every inline style it added and puts any split text back as the original text nodes.

The physics is a small rigid-body engine for boxes and circles, written for this package after Erin Catto's [Box2D Lite](https://github.com/erincatto/box2d-lite). It finds box contacts with separating axes and edge clipping, and solves them with warm-started sequential impulses. It steps at a fixed 240 Hz, which keeps stacks standing. Touching bodies fall asleep together once they stop, and a page at rest uses no frames at all. You can use the engine directly:

```js
import { World, Body } from '@elementalfx/gravity';

const world = new World({ gravity: 2000 });
world.add(new Body({ x: 400, y: 620, width: 800, height: 40, density: 0 })); // static floor
const box = world.add(new Body({ x: 400, y: 100, width: 60, height: 40 }));
world.step(1 / 60);
```

Elements inside scrolling containers or `overflow: hidden` boxes are clipped by them as they fall.

MIT License
