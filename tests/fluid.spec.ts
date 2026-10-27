import { expect, test } from 'playwright/test';
import { diff, frames, open, shot } from './helpers';

const FLUID = '/packages/fluid/dist/fluid.global.js';

type Win = Window & { fx: any; ElementalFX: any; __frames: number };

test.describe('fluid', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, [FLUID]);
    await page.evaluate(() => {
      document.body.style.cssText = 'margin:0;height:600px;background:#10131a';
    });
  });

  test('cursor mode: a transparent page overlay that follows the pointer', async ({ page }) => {
    const info = await page.evaluate(async () => {
      const w = window as unknown as Win;
      w.fx = w.ElementalFX.fluid.createFluid(document.body, { quality: 'low' });
      const ok = await w.fx.ready;
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-fx="fluid"]')!;
      return { ok, mode: w.fx.mode, position: canvas.style.position, pointer: canvas.style.pointerEvents };
    });
    expect(info).toEqual({ ok: true, mode: 'cursor', position: 'fixed', pointer: 'none' });
    const body = page.locator('body');
    await frames(page, 3);
    const calm = await shot(body);
    await page.mouse.move(100, 300);
    for (let i = 1; i <= 20; i++) await page.mouse.move(100 + i * 30, 300 + Math.sin(i / 3) * 80);
    await frames(page, 4);
    expect(await diff(page, calm, await shot(body))).toBeGreaterThan(0.5);
  });

  test('background mode sits behind content and keeps moving by itself', async ({ page }) => {
    const info = await page.evaluate(async () => {
      const w = window as unknown as Win;
      document.body.innerHTML = '<section id="hero" style="height:400px;margin:20px"><h1 id="title" style="margin:0;color:#fff">Hello</h1></section>';
      w.fx = w.ElementalFX.fluid.createFluid('#hero', { preset: 'neon', quality: 'low' });
      await w.fx.ready;
      const canvas = document.querySelector<HTMLCanvasElement>('#hero > canvas')!;
      const title = document.getElementById('title')!.getBoundingClientRect();
      const top = document.elementFromPoint(title.left + 5, title.top + 5)!.id;
      return { mode: w.fx.mode, z: canvas.style.zIndex, top };
    });
    expect(info).toEqual({ mode: 'background', z: '-1', top: 'title' });
    const hero = page.locator('#hero');
    const a = await shot(hero);
    await page.waitForTimeout(700);
    expect(await diff(page, a, await shot(hero))).toBeGreaterThan(0.2);
  });

  test('splat adds dye, clear removes it', async ({ page }) => {
    await page.evaluate(() => {
      const w = window as unknown as Win;
      document.body.innerHTML = '<div id="box" style="width:500px;height:300px;margin:20px"></div>';
      w.fx = w.ElementalFX.fluid.createFluid('#box', { ambient: 0, quality: 'low', interactive: false });
      return w.fx.ready;
    });
    await page.evaluate(() => (window as unknown as Win).fx.clear());
    await frames(page, 2);
    const box = page.locator('#box');
    const empty = await shot(box);
    await page.evaluate(() => {
      const fx = (window as unknown as Win).fx;
      fx.splat(250, 150, 120, -40, '#ff6a00');
      fx.splat(150, 100, -60, 80, '#00c2ff');
    });
    await frames(page, 4);
    expect(await diff(page, empty, await shot(box))).toBeGreaterThan(0.3);
    await page.evaluate(() => (window as unknown as Win).fx.clear());
    await frames(page, 2);
    expect(await diff(page, empty, await shot(box))).toBeLessThan(0.1);
  });

  test('settles and stops drawing when nobody interacts', async ({ page }) => {
    await page.evaluate(() => {
      const w = window as unknown as Win;
      w.fx = w.ElementalFX.fluid.createFluid(document.body, { dyeDissipation: 5, quality: 'low' });
      return w.fx.ready;
    });
    await page.evaluate(() => (window as unknown as Win).fx.splat(300, 300, 80, 0));
    // Software WebGL can be slow under load, so poll until frames stop rather than guess a delay.
    const framesIn = async (ms: number): Promise<number> => {
      const before = await page.evaluate(() => (window as unknown as Win).__frames);
      await page.waitForTimeout(ms);
      return (await page.evaluate(() => (window as unknown as Win).__frames)) - before;
    };
    await expect.poll(() => framesIn(400), { timeout: 20_000, intervals: [500] }).toBeLessThanOrEqual(1);
  });

  test('honours a fixed quality tier', async ({ page }) => {
    const quality = await page.evaluate(async () => {
      const w = window as unknown as Win;
      w.fx = w.ElementalFX.fluid.createFluid(document.body, { quality: 'medium' });
      await w.fx.ready;
      return w.fx.quality;
    });
    expect(quality).toBe('medium');
  });

  test('does nothing when the user prefers reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const ok = await page.evaluate(() => {
      const w = window as unknown as Win;
      w.fx = w.ElementalFX.fluid.createFluid(document.body);
      return w.fx.ready;
    });
    expect(ok).toBe(false);
    expect(await page.locator('canvas').count()).toBe(0);
  });

  test('<fx-fluid> sets up behind its content and restores the page on removal', async ({ page }) => {
    const before = await page.evaluate(() => {
      document.body.innerHTML = '<main id="main"><p>Content</p></main>';
      return document.body.innerHTML;
    });
    await page.evaluate(() => {
      const el = document.createElement('fx-fluid');
      el.setAttribute('preset', 'smoke');
      el.setAttribute('quality', 'low');
      el.style.height = '300px';
      el.innerHTML = '<h2>Inside</h2>';
      document.getElementById('main')!.append(el);
    });
    await expect(page.locator('fx-fluid canvas')).toHaveCount(1);
    expect(await page.evaluate(() => (document.querySelector('fx-fluid') as any).effect.options.preset)).toBe('smoke');
    await page.evaluate(() => document.querySelector('fx-fluid')!.remove());
    expect(await page.evaluate(() => document.body.innerHTML)).toBe(before);
  });
});
