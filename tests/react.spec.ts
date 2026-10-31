import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from 'playwright/test';
import { open } from './helpers';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// A tiny app bundle: React plus every component, exposed on window.R for the tests to drive.
// It resolves from the React package, so its effect packages come from that package's
// own links, as they would for a user.
let bundle: Promise<string> | null = null;
function app(): Promise<string> {
  bundle ??= build({
    stdin: {
      resolveDir: resolve(root, 'packages/react'),
      contents: `
        import * as React from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { Ripples } from './dist/ripples.js';
        import { Weather } from './dist/weather.js';
        import { Fluid } from './dist/fluid.js';
        import { Gravity } from './dist/gravity.js';
        import { Dissolve } from './dist/dissolve.js';
        window.R = { React, createRoot, flushSync, Ripples, Weather, Fluid, Gravity, Dissolve };
      `,
    },
    bundle: true,
    write: false,
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'silent',
  }).then((result) => result.outputFiles[0]!.text);
  return bundle;
}

type Win = Window & { R: any; root: any; fx: any; seen: unknown[]; done: boolean[] };

async function setup(page: Page): Promise<void> {
  await open(page, []);
  await page.addScriptTag({ content: await app() });
  await page.evaluate(() => {
    document.body.style.cssText = 'margin:0;background:#10131a';
    document.body.innerHTML = '<div id="app"></div>';
    const w = window as unknown as Win;
    w.root = w.R.createRoot(document.getElementById('app'));
    w.seen = [];
    w.done = [];
  });
}

/** Renders `(R, h) => element` synchronously. */
function render(page: Page, source: string): Promise<void> {
  return page.evaluate((code) => {
    const w = window as unknown as Win;
    const element = new Function('R', 'h', `return ${code}`)(w.R, w.R.React.createElement);
    w.R.flushSync(() => w.root.render(element));
  }, source);
}

test.describe('react', () => {
  test.beforeEach(async ({ page }) => {
    await setup(page);
  });

  test('a component starts its effect on mount and removes it on unmount', async ({ page }) => {
    await render(page, "h(R.Fluid, { id: 'box', style: { height: '200px' }, options: { quality: 'low', ambient: 0 } }, h('p', null, 'hi'))");
    await expect(page.locator('#box canvas')).toHaveCount(1);
    await expect(page.locator('#box p')).toHaveText('hi');
    await render(page, 'null');
    await expect(page.locator('canvas')).toHaveCount(0);
  });

  test('Strict Mode still ends up with one effect', async ({ page }) => {
    await render(page, "h(R.React.StrictMode, null, h(R.Weather, { id: 'sky', style: { height: '200px' }, options: { preset: 'snow' } }))");
    await expect(page.locator('#sky canvas')).toHaveCount(1);
  });

  test('changing options updates the running effect instead of recreating it', async ({ page }) => {
    await render(page, "h(R.Fluid, { style: { height: '200px' }, options: { quality: 'low', brightness: 0.2 }, onReady: (fx) => window.seen.push(fx) })");
    await expect.poll(() => page.evaluate(() => (window as unknown as Win).seen.length)).toBe(1);
    await render(page, "h(R.Fluid, { style: { height: '200px' }, options: { quality: 'low', brightness: 0.6 }, onReady: (fx) => window.seen.push(fx) })");
    await expect.poll(() => page.evaluate(() => (window as unknown as Win).seen[0] && (window as any).seen[0].options.brightness)).toBe(0.6);
    expect(await page.evaluate(() => (window as unknown as Win).seen.length)).toBe(1);
  });

  test('page mode covers the whole page and renders children with no wrapper', async ({ page }) => {
    await render(page, "h(R.Weather, { page: true, options: { preset: 'snow' } }, h('h1', { id: 'title' }, 'Snow day'))");
    expect(await page.evaluate(() => document.getElementById('app')!.firstElementChild!.id)).toBe('title');
    await expect(page.locator('body > canvas')).toHaveCount(1);
    await render(page, 'null');
    await expect(page.locator('canvas')).toHaveCount(0);
  });

  test('Gravity hands over its instance and cleans up on unmount', async ({ page }) => {
    await render(page, "h(R.Gravity, { id: 'room', style: { height: '300px' }, options: { restoreDuration: 0.1 }, onReady: (fx) => { window.fx = fx; } }, h('p', { id: 'line' }, 'Falling'))");
    await expect.poll(() => page.evaluate(() => Boolean((window as unknown as Win).fx))).toBe(true);
    await page.evaluate(() => (window as unknown as Win).fx.drop());
    expect(await page.evaluate(() => (window as unknown as Win).fx.state)).toBe('falling');
    expect(await page.evaluate(() => document.getElementById('line')!.style.transform)).toContain('translate');
    await render(page, 'null');
    expect(await page.evaluate(() => (window as unknown as Win).fx.state)).toBe('idle');
  });

  test('Dissolve starts hidden and animates when show changes', async ({ page }) => {
    const props = "{ id: 'card', style: { width: '200px', height: '100px', background: '#f4efe6' }, options: { duration: 0.3 }, onDone: (shown) => window.done.push(shown) }";
    await render(page, `h(R.Dissolve, { show: false, ...${props} }, 'Hello')`);
    // Hidden from the first frame, with no animation.
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('card')!).visibility)).toBe('hidden');
    await render(page, `h(R.Dissolve, { show: true, ...${props} }, 'Hello')`);
    await expect.poll(() => page.evaluate(() => (window as unknown as Win).done)).toEqual([true]);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('card')!).visibility)).toBe('visible');
    await render(page, `h(R.Dissolve, { show: false, ...${props} }, 'Hello')`);
    await expect.poll(() => page.evaluate(() => (window as unknown as Win).done)).toEqual([true, false]);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('card')!).visibility)).toBe('hidden');
  });
});
