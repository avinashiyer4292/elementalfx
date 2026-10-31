// The React components must render on the server without touching the DOM.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '../..');
const load = (path) => import(pathToFileURL(join(root, 'packages/react/dist', path)).href);

test('every component renders to a string on the server', async () => {
  const { createElement } = await import('react');
  const { renderToString } = await import('react-dom/server');
  const { Ripples } = await load('ripples.js');
  const { Weather } = await load('weather.js');
  const { Fluid } = await load('fluid.js');
  const { Gravity } = await load('gravity.js');
  const { Dissolve } = await load('dissolve.js');
  const child = createElement('p', null, 'hello');
  const html = renderToString(
    createElement(
      'main',
      null,
      createElement(Ripples, { className: 'pond', options: { preset: 'rain' } }, child),
      createElement(Weather, { page: true, options: { preset: 'snow' } }, child),
      createElement(Fluid, { as: 'section', options: { preset: 'ink' } }, child),
      createElement(Gravity, { options: { trigger: 'konami' } }, child),
      createElement(Dissolve, { show: false, id: 'card' }, child),
    ),
  );
  assert.equal(typeof globalThis.window, 'undefined');
  assert.match(html, /<div class="pond"><p>hello<\/p><\/div>/);
  // page mode renders its children with no wrapper
  assert.match(html, /<\/div><p>hello<\/p><section>/);
  assert.match(html, /<section><p>hello<\/p><\/section>/);
  assert.match(html, /<div id="card"><p>hello<\/p><\/div>/);
});
