import { expect, test } from 'playwright/test';
import { RIPPLES, diff, frames, open, shot } from './helpers';

type Win = Window & {
  makeImage(w?: number, h?: number): string;
  __frames: number;
  fx: any;
  ElementalFX: any;
};

test.describe('ripples', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, [RIPPLES]);
  });

  test('draws a CSS background faithfully before any drop', async ({ page }) => {
    await page.evaluate(() => {
      const w = window as unknown as Win;
      const box = document.createElement('div');
      box.className = 'box';
      box.id = 'target';
      box.style.backgroundImage = `url(${w.makeImage()})`;
      box.style.backgroundSize = 'cover';
      box.style.backgroundPosition = 'center';
      document.body.append(box);
    });
    const target = page.locator('#target');
    const original = await shot(target);
    const ready = await page.evaluate(() => {
      const w = window as unknown as Win;
      w.fx = w.ElementalFX.ripples.createRipples('#target');
      return w.fx.ready;
    });
    expect(ready).toBe(true);
    await frames(page, 3);
    expect(await page.locator('#target canvas').count()).toBe(1);
    expect(await page.evaluate(() => document.getElementById('target')!.style.backgroundImage)).toBe('none');
    // Mapping (cover, centred) must match what the browser drew.
    expect(await diff(page, original, await shot(target))).toBeLessThan(3);
  });

  test('a drop visibly disturbs the image, and the water settles after the idle timeout', async ({ page }) => {
    await page.evaluate(() => {
      const w = window as unknown as Win;
      const box = document.createElement('div');
      box.className = 'box';
      box.id = 'target';
      box.style.backgroundImage = `url(${w.makeImage()})`;
      box.style.backgroundSize = 'cover';
      document.body.append(box);
    });
    const target = page.locator('#target');
    await page.evaluate(() => {
      const w = window as unknown as Win;
      w.fx = w.ElementalFX.ripples.createRipples('#target', { idleTimeout: 1 });
      return w.fx.ready;
    });
    await frames(page, 3);
    const calm = await shot(target);
    await page.evaluate(() => (window as unknown as Win).fx.drop(200, 150, 40, 0.5));
    await frames(page, 12);
    expect(await diff(page, calm, await shot(target))).toBeGreaterThan(4);

    // After the idle timeout the simulation clears and frames stop.
    await page.waitForTimeout(1600);
    const settled = await shot(target);
    expect(await diff(page, calm, settled)).toBeLessThan(1);
    const before = await page.evaluate(() => (window as unknown as Win).__frames);
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => (window as unknown as Win).__frames);
    expect(after - before).toBeLessThanOrEqual(1);
  });

  test('pointer movement makes ripples', async ({ page }) => {
    await page.evaluate(() => {
      const w = window as unknown as Win;
      const box = document.createElement('div');
      box.className = 'box';
      box.id = 'target';
      box.style.backgroundImage = `url(${w.makeImage()})`;
      box.style.backgroundSize = 'cover';
      document.body.append(box);
      w.fx = w.ElementalFX.ripples.createRipples('#target');
      return w.fx.ready;
    });
    await frames(page, 3);
    const target = page.locator('#target');
    const calm = await shot(target);
    await page.mouse.move(50, 150);
    await page.mouse.move(350, 150, { steps: 12 });
    await frames(page, 6);
    expect(await diff(page, calm, await shot(target))).toBeGreaterThan(1.5);
  });

  test('works on an <img> inside a container, honouring object-fit', async ({ page }) => {
    await page.evaluate(async () => {
      const w = window as unknown as Win;
      const wrap = document.createElement('div');
      wrap.id = 'target';
      wrap.style.width = '420px';
      const img = document.createElement('img');
      img.src = w.makeImage(500, 500);
      img.style.cssText = 'display:block;width:420px;height:260px;object-fit:cover';
      img.alt = 'test';
      wrap.append(img);
      document.body.append(wrap);
      await img.decode();
    });
    const target = page.locator('#target');
    const original = await shot(target);
    const ready = await page.evaluate(() => {
      const w = window as unknown as Win;
      w.fx = w.ElementalFX.ripples.createRipples('#target');
      return w.fx.ready;
    });
    expect(ready).toBe(true);
    await frames(page, 3);
    expect(await page.evaluate(() => document.querySelector('#target img')!.getAttribute('style'))).toContain('opacity: 0');
    expect(await diff(page, original, await shot(target))).toBeLessThan(3);
    await page.evaluate(() => (window as unknown as Win).fx.drop(210, 130, 40, 0.5));
    await frames(page, 10);
    expect(await diff(page, original, await shot(target))).toBeGreaterThan(4);
  });

  test('works on an <img> element directly', async ({ page }) => {
    await page.evaluate(async () => {
      const w = window as unknown as Win;
      const img = document.createElement('img');
      img.id = 'target';
      img.src = w.makeImage(300, 200);
      img.style.cssText = 'display:block;margin:40px;width:360px;height:240px';
      document.body.append(img);
      await img.decode();
    });
    const target = page.locator('#target');
    const original = await shot(target);
    const ready = await page.evaluate(() => {
      const w = window as unknown as Win;
      w.fx = w.ElementalFX.ripples.createRipples('#target');
      return w.fx.ready;
    });
    expect(ready).toBe(true);
    await frames(page, 3);
    // The canvas sits exactly over the image.
    const [a, b] = await page.evaluate(() => {
      const img = document.getElementById('target')!.getBoundingClientRect();
      const canvas = document.querySelector('canvas[data-fx="ripples"]')!.getBoundingClientRect();
      return [
        [img.left, img.top, img.width, img.height],
        [canvas.left, canvas.top, canvas.width, canvas.height],
      ];
    });
    expect(b).toEqual(a);
    expect(await diff(page, original, await shot(target))).toBeLessThan(3);
  });

  test('destroy restores the element exactly', async ({ page }) => {
    const before = await page.evaluate(async () => {
      const w = window as unknown as Win;
      const box = document.createElement('div');
      box.className = 'box';
      box.id = 'target';
      box.style.backgroundImage = `url(${w.makeImage()})`;
      document.body.append(box);
      const html = box.outerHTML;
      w.fx = w.ElementalFX.ripples.createRipples(box);
      await w.fx.ready;
      return html;
    });
    await frames(page, 2);
    const after = await page.evaluate(() => {
      const w = window as unknown as Win;
      w.fx.destroy();
      return document.getElementById('target')!.outerHTML;
    });
    expect(after).toBe(before);
  });

  test('8-bit fallback simulates and settles', async ({ page }) => {
    await page.evaluate(() => {
      const w = window as unknown as Win;
      const box = document.createElement('div');
      box.className = 'box';
      box.id = 'target';
      box.style.backgroundImage = `url(${w.makeImage()})`;
      box.style.backgroundSize = 'cover';
      document.body.append(box);
      w.fx = w.ElementalFX.ripples.createRipples('#target', { forcePacked: true, idleTimeout: 1 });
      return w.fx.ready;
    });
    const target = page.locator('#target');
    await frames(page, 3);
    const calm = await shot(target);
    await page.evaluate(() => (window as unknown as Win).fx.drop(200, 150, 40, 0.5));
    await frames(page, 12);
    expect(await diff(page, calm, await shot(target))).toBeGreaterThan(4);
    await page.waitForTimeout(1600);
    expect(await diff(page, calm, await shot(target))).toBeLessThan(1);
  });

  test('rain preset ripples without interaction', async ({ page }) => {
    await page.evaluate(() => {
      const w = window as unknown as Win;
      const box = document.createElement('div');
      box.className = 'box';
      box.id = 'target';
      box.style.backgroundImage = `url(${w.makeImage()})`;
      box.style.backgroundSize = 'cover';
      document.body.append(box);
    });
    const target = page.locator('#target');
    const original = await shot(target);
    await page.evaluate(() => {
      const w = window as unknown as Win;
      w.fx = w.ElementalFX.ripples.createRipples('#target', { preset: 'rain', rain: { rate: 30 } });
      return w.fx.ready;
    });
    await page.waitForTimeout(800);
    expect(await diff(page, original, await shot(target))).toBeGreaterThan(1);
  });

  test('does nothing when the user prefers reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const ready = await page.evaluate(() => {
      const w = window as unknown as Win;
      const box = document.createElement('div');
      box.className = 'box';
      box.id = 'target';
      box.style.backgroundImage = `url(${w.makeImage()})`;
      document.body.append(box);
      w.fx = w.ElementalFX.ripples.createRipples(box);
      return w.fx.ready;
    });
    expect(ready).toBe(false);
    expect(await page.locator('canvas').count()).toBe(0);
    // Turning the preference off starts the effect.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(page.locator('#target canvas')).toHaveCount(1);
  });

  test('<fx-ripples> element sets up and tears down', async ({ page }) => {
    await page.evaluate(async () => {
      const w = window as unknown as Win;
      document.body.insertAdjacentHTML(
        'beforeend',
        `<fx-ripples id="target" drop-radius="30" perturbance="0.05"><img alt="" style="display:block;width:400px;height:300px" src="${w.makeImage()}"></fx-ripples>`,
      );
      await document.querySelector<HTMLImageElement>('#target img')!.decode();
    });
    const element = page.locator('#target');
    await expect(element.locator('canvas')).toHaveCount(1);
    const options = await page.evaluate(() => {
      const el = document.getElementById('target') as any;
      return { dropRadius: el.effect.options.dropRadius, perturbance: el.effect.options.perturbance };
    });
    expect(options).toEqual({ dropRadius: 30, perturbance: 0.05 });
    await page.evaluate(() => document.getElementById('target')!.setAttribute('drop-radius', '12'));
    expect(await page.evaluate(() => (document.getElementById('target') as any).effect.options.dropRadius)).toBe(12);
    await page.evaluate(() => document.getElementById('target')!.remove());
    expect(await page.locator('canvas').count()).toBe(0);
  });
});
