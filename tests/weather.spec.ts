import { expect, test, type Page } from 'playwright/test';
import { diff, frames, open, shot } from './helpers';

const WEATHER = '/packages/weather/dist/weather.global.js';

type Win = Window & { wx: any; ElementalFX: any; __frames: number; hits: number };

async function cards(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.body.style.background = '#1d2b3a';
    document.body.innerHTML = `<div style="display:flex;gap:40px;padding:220px 60px 0">${[1, 2, 3]
      .map((i) => `<div class="card" style="flex:1;height:120px;border-radius:12px;background:#e8eef3">Card ${i}</div>`)
      .join('')}</div>`;
  });
}

test.describe('weather', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, [WEATHER]);
    await cards(page);
  });

  test('covers the page with falling snow that moves over time', async ({ page }) => {
    const info = await page.evaluate(async () => {
      const w = window as unknown as Win;
      w.wx = w.ElementalFX.weather.createWeather(document.body, { preset: 'snow', seed: 7 });
      const ok = await w.wx.ready;
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-fx="weather"]')!;
      return { ok, renderer: w.wx.renderer, position: canvas.style.position, pointer: canvas.style.pointerEvents };
    });
    expect(info).toEqual({ ok: true, renderer: 'webgl2', position: 'fixed', pointer: 'none' });
    expect(await page.evaluate(() => (window as unknown as Win).wx.stats().particles)).toBeGreaterThan(50);
    const a = await shot(page.locator('body'));
    await page.waitForTimeout(500);
    const b = await shot(page.locator('body'));
    expect(await diff(page, a, b)).toBeGreaterThan(0.05);
  });

  test('snow settles on chosen elements and melts once the snow stops', async ({ page }) => {
    await page.evaluate(() => {
      const w = window as unknown as Win;
      w.wx = w.ElementalFX.weather.createWeather(document.body, {
        effects: 'snow',
        snow: { density: 4 },
        settleOn: '.card',
        seed: 3,
      });
      return w.wx.ready;
    });
    await page.waitForTimeout(3500);
    const stats = await page.evaluate(() => (window as unknown as Win).wx.stats());
    expect(stats.surfaces).toBe(3);
    expect(stats.settledSnow).toBeGreaterThan(20);
    await page.evaluate(() => (window as unknown as Win).wx.remove('snow'));
    await page.waitForTimeout(6000);
    const after = await page.evaluate(() => (window as unknown as Win).wx.stats().settledSnow);
    expect(after).toBeLessThan(stats.settledSnow * 0.5);
  });

  test('rain splashes and makes drop targets ripple', async ({ page }) => {
    await page.evaluate(() => {
      const w = window as unknown as Win;
      const pool = document.createElement('div');
      pool.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:45%';
      document.body.append(pool);
      w.hits = 0;
      w.wx = w.ElementalFX.weather.createWeather(document.body, {
        preset: 'rain',
        ripples: [{ element: pool, drop: () => w.hits++ }],
        seed: 5,
      });
      return w.wx.ready;
    });
    await page.waitForTimeout(1200);
    const result = await page.evaluate(() => {
      const w = window as unknown as Win;
      return { splashes: w.wx.stats().splashes, hits: w.hits };
    });
    expect(result.splashes).toBeGreaterThan(5);
    expect(result.hits).toBeGreaterThan(5);
  });

  test('lightning never flashes more than three times in a second', async ({ page }) => {
    const peaks = await page.evaluate(async () => {
      const w = window as unknown as Win;
      w.wx = w.ElementalFX.weather.createWeather(document.body, { effects: [], lightning: { rate: 0 }, seed: 1 });
      await w.wx.ready;
      for (let i = 0; i < 10; i++) w.wx.strike();
      // Count rising edges of the flash over 1.2 s.
      let rises = 0;
      let previous = 0;
      let rising = false;
      const started = performance.now();
      while (performance.now() - started < 1200) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const flash = w.wx.stats().flash;
        if (flash > previous + 0.01 && !rising) {
          rises++;
          rising = true;
        } else if (flash < previous) {
          rising = false;
        }
        previous = flash;
      }
      return rises;
    });
    expect(peaks).toBeGreaterThan(0);
    expect(peaks).toBeLessThanOrEqual(3);
  });

  test('stops scheduling frames when every effect is off and the sky is clear', async ({ page }) => {
    await page.evaluate(() => {
      const w = window as unknown as Win;
      w.wx = w.ElementalFX.weather.createWeather(document.body, { effects: 'rain', seed: 2 });
      return w.wx.ready;
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => (window as unknown as Win).wx.remove('rain'));
    await page.waitForTimeout(2000);
    const before = await page.evaluate(() => (window as unknown as Win).__frames);
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => (window as unknown as Win).__frames);
    expect(await page.evaluate(() => (window as unknown as Win).wx.stats().particles)).toBe(0);
    expect(after - before).toBeLessThanOrEqual(1);
    // Adding an effect starts it again.
    await page.evaluate(() => (window as unknown as Win).wx.add('snow'));
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as Win).wx.stats().particles)).toBeGreaterThan(0);
  });

  test('Canvas 2D fallback draws the same weather', async ({ page }) => {
    const before = await shot(page.locator('body'));
    const renderer = await page.evaluate(async () => {
      const w = window as unknown as Win;
      w.wx = w.ElementalFX.weather.createWeather(document.body, { preset: 'blizzard', forceCanvas2D: true, seed: 9 });
      await w.wx.ready;
      return w.wx.renderer;
    });
    expect(renderer).toBe('canvas2d');
    await frames(page, 4);
    expect(await diff(page, before, await shot(page.locator('body')))).toBeGreaterThan(0.2);
  });

  test('does nothing when the user prefers reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const ok = await page.evaluate(() => {
      const w = window as unknown as Win;
      w.wx = w.ElementalFX.weather.createWeather(document.body, { preset: 'storm' });
      return w.wx.ready;
    });
    expect(ok).toBe(false);
    expect(await page.locator('canvas').count()).toBe(0);
  });

  test('<fx-weather> covers its own box and restores it on removal', async ({ page }) => {
    const before = await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<section id="box" style="height:240px;margin:20px;background:#223"><p>Hello</p></section>',
      );
      return document.getElementById('box')!.outerHTML;
    });
    await page.evaluate(() => {
      const box = document.getElementById('box')!;
      const el = document.createElement('fx-weather');
      el.setAttribute('effects', 'snow leaves');
      el.setAttribute('wind-speed', '0.5');
      el.style.cssText = 'position:absolute;inset:0';
      box.append(el);
    });
    await expect(page.locator('#box fx-weather canvas')).toHaveCount(1);
    const state = await page.evaluate(() => {
      const el = document.querySelector('fx-weather') as any;
      return { wind: el.effect.options.wind.speed, effects: [...el.effect.options.effects].sort(), position: el.querySelector('canvas').style.position };
    });
    expect(state).toEqual({ wind: 0.5, effects: ['leaves', 'snow'], position: 'absolute' });
    await page.evaluate(() => document.querySelector('fx-weather')!.setAttribute('wind-speed', '0.1'));
    expect(await page.evaluate(() => (document.querySelector('fx-weather') as any).effect.options.wind.speed)).toBe(0.1);
    await page.evaluate(() => document.querySelector('fx-weather')!.remove());
    expect(await page.evaluate(() => document.getElementById('box')!.outerHTML)).toBe(before);
  });
});
