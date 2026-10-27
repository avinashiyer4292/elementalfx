// Every entry point must import cleanly in Node (server rendering), without a DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

for (const name of readdirSync(join(root, 'packages'))) {
  const dir = join(root, 'packages', name);
  if (!existsSync(join(dir, 'package.json'))) continue;
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  for (const [subpath, value] of Object.entries(manifest.exports ?? {})) {
    const target = typeof value === 'string' ? value : value.import;
    if (!target?.endsWith('.js') || target.endsWith('.global.js')) continue;
    test(`${manifest.name}${subpath === '.' ? '' : subpath.slice(1)} imports without a DOM`, async () => {
      assert.equal(typeof globalThis.window, 'undefined');
      const module = await import(pathToFileURL(join(dir, target)).href);
      assert.ok(Object.keys(module).length > 0);
    });
  }
}

test('effects created during SSR are inert', async () => {
  const { createRipples } = await import(pathToFileURL(join(root, 'packages/ripples/dist/index.js')).href);
  const fx = createRipples({});
  assert.equal(await fx.ready, false);
  fx.drop(1, 1);
  fx.destroy();
});
