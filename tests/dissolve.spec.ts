import { expect, test, type Page } from 'playwright/test';
import { frames, open, shot } from './helpers';

const DISSOLVE = '/packages/dissolve/dist/dissolve.global.js';

type Win = Window & { ElementalFX: any; run: Promise<void> };

async function setup(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.body.style.cssText = 'margin:0;padding:24px;background:#14161c';
    document.body.innerHTML = `
      <div id="card" style="width:300px;padding:16px;background:#f4efe6;color:#1d2433;border-radius:12px;font:16px/1.4 sans-serif">
        <h2 style="margin:0 0 6px">Perfectly balanced</h2><p style="margin:0">As all things should be.</p>
      </div>
      <div id="red" style="width:120px;height:80px;margin-top:20px;background:rgb(220,30,30)"></div>`;
  });
}

const call = (page: Page, script: string): Promise<void> =>
  page.evaluate((source) => {
    const w = window as unknown as Win;
    w.run = new Function('D', `return ${source}`)(w.ElementalFX.dissolve) as Promise<void>;
  }, script);

const finished = (page: Page): Promise<void> => page.evaluate(() => (window as unknown as Win).run);

/** Share of pixels in a screenshot that look like fire: bright, orange, little blue. */
function fiery(page: Page, dataUrl: string): Promise<number> {
  return page.evaluate(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let hits = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i]! > 200 && data[i + 1]! > 70 && data[i + 1]! < 190 && data[i + 2]! < 90) hits++;
    }
    return hits / (data.length / 4);
  }, dataUrl);
}

test.describe('dissolve', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, [DISSOLVE]);
    await setup(page);
  });

  test('dust: the element crumbles, specks fly, and it ends up hidden', async ({ page }) => {
    const before = await shot(page.locator('body'));
    await call(page, "D.dissolve('#card', { duration: 0.5, seed: 1 })");
    await finished(page);
    const state = await page.evaluate(() => ({
      visibility: getComputedStyle(document.getElementById('card')!).visibility,
      filters: document.querySelectorAll('filter').length,
      filterStyle: document.getElementById('card')!.style.filter,
      specks: (window as unknown as Win).ElementalFX.dissolve.activeSpecks(),
      dissolved: (window as unknown as Win).ElementalFX.dissolve.isDissolved('#card'),
    }));
    expect(state).toMatchObject({ visibility: 'hidden', filters: 0, filterStyle: '', dissolved: true });
    expect(state.specks).toBeGreaterThan(100);
    expect(before).not.toBe(await shot(page.locator('body')));
    // The specks blow away and the overlay goes with them.
    await expect.poll(() => page.evaluate(() => document.querySelectorAll('canvas[data-fx]').length), { timeout: 8000 }).toBe(0);
  });

  test('half way through, part of the element is gone', async ({ page }) => {
    const card = page.locator('#card');
    const before = await shot(card);
    await call(page, "D.dissolve('#card', { effect: 'fade', duration: 60, direction: 'right', noise: 0 })");
    // A slow, straight sweep: after a while the left side has faded and the right hasn't.
    await expect.poll(() => page.evaluate(() => document.getElementById('card')!.style.filter)).toContain('fx-dissolve-');
    await page.waitForTimeout(6000);
    const box = (await card.boundingBox())!;
    const left = await shot(page.locator('body').locator('#card'));
    expect(left).not.toBe(before);
    const leftEdge = await page.screenshot({ clip: { x: box.x, y: box.y, width: 20, height: box.height } });
    const rightEdge = await page.screenshot({ clip: { x: box.x + box.width - 20, y: box.y, width: 20, height: box.height } });
    const brightness = (png: Buffer): Promise<number> =>
      page.evaluate(async (url) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) sum += data[i]! + data[i + 1]! + data[i + 2]!;
        return sum / (data.length / 4) / 3;
      }, `data:image/png;base64,${png.toString('base64')}`);
    // The light card fades first on the left, showing the dark page through it.
    expect(await brightness(leftEdge)).toBeLessThan((await brightness(rightEdge)) - 20);
  });

  test('burn shows a glowing edge', async ({ page }) => {
    // Software WebGL and SVG filters are slow under a parallel test run.
    test.setTimeout(60_000);
    await call(page, "D.dissolve('#card', { effect: 'burn', duration: 20, seed: 2 })");
    await page.waitForTimeout(7000);
    const box = (await page.locator('#card').boundingBox())!;
    const png = await page.screenshot({ clip: { x: box.x - 10, y: box.y - 10, width: box.width + 20, height: box.height + 20 } });
    const fire = await fiery(page, `data:image/png;base64,${png.toString('base64')}`);
    expect(fire).toBeGreaterThan(0.001);
  });

  test('melt and fade finish and hide the element', async ({ page }) => {
    await call(page, "Promise.all([D.dissolve('#card', { effect: 'melt', duration: 0.4 }), D.dissolve('#red', { effect: 'fade', duration: 0.3 })])");
    await finished(page);
    const hidden = await page.evaluate(() => ['card', 'red'].map((id) => getComputedStyle(document.getElementById(id)!).visibility));
    expect(hidden).toEqual(['hidden', 'hidden']);
    expect(await page.evaluate(() => document.querySelectorAll('filter').length)).toBe(0);
  });

  test('assemble brings it back exactly as it was', async ({ page }) => {
    const style = await page.evaluate(() => document.getElementById('card')!.getAttribute('style'));
    await call(page, "D.dissolve('#card', { duration: 0.3 })");
    await finished(page);
    await call(page, "D.assemble('#card', { duration: 0.5 })");
    await finished(page);
    const state = await page.evaluate(() => ({
      style: document.getElementById('card')!.getAttribute('style'),
      visibility: getComputedStyle(document.getElementById('card')!).visibility,
      dissolved: (window as unknown as Win).ElementalFX.dissolve.isDissolved('#card'),
    }));
    expect(state).toEqual({ style, visibility: 'visible', dissolved: false });
  });

  test("after: 'remove' takes the element out of the page", async ({ page }) => {
    await call(page, "D.dissolve('#red', { duration: 0.3, after: 'remove' })");
    await finished(page);
    expect(await page.locator('#red').count()).toBe(0);
  });

  test('a new animation finishes the one already running', async ({ page }) => {
    await call(page, "D.dissolve('#card', { duration: 30 })");
    await frames(page, 3);
    await call(page, "D.assemble('#card', { duration: 0.3 })");
    await finished(page);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('card')!).visibility)).toBe('visible');
    expect(await page.evaluate(() => document.querySelectorAll('filter').length)).toBe(0);
  });

  test('reduced motion: a plain fade, no filters or specks', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await call(page, "D.dissolve('#card')");
    expect(await page.evaluate(() => document.querySelectorAll('filter').length)).toBe(0);
    await finished(page);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('card')!).visibility)).toBe('hidden');
    expect(await page.evaluate(() => (window as unknown as Win).ElementalFX.dissolve.activeSpecks())).toBe(0);
  });
});
