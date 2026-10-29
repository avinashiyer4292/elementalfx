import { expect, test, type Page } from 'playwright/test';
import { open } from './helpers';

const GRAVITY = '/packages/gravity/dist/gravity.global.js';

type Win = Window & { fx: any; ElementalFX: any; __frames: number };

const PAGE = `
  <main id="main" style="padding:24px;font:16px/1.5 sans-serif">
    <h1 id="title" style="margin:0 0 12px">Everything falls</h1>
    <p id="lead">Three little words and then some more.</p>
    <div class="actions" style="display:flex;gap:12px">
      <button id="go">Go</button>
      <a id="link" href="#clicked">A link</a>
    </div>
    <div id="card" style="width:220px;margin-top:16px;padding:12px;background:#fff;border:1px solid #ccc">
      <h3 style="margin:0">Card</h3><p style="margin:0">Falls as one</p>
    </div>
    <canvas id="art" width="80" height="60" style="display:block;margin-top:16px;background:#2d6be2"></canvas>
  </main>`;

async function setup(page: Page, options: Record<string, unknown> = {}): Promise<void> {
  await page.evaluate(
    ([html, opts]) => {
      document.body.style.cssText = 'margin:0;background:#f6f3ee';
      document.body.innerHTML = html as string;
      const w = window as unknown as Win;
      w.fx = w.ElementalFX.gravity.createGravity(document.body, { restoreDuration: 0.2, ...(opts as object) });
    },
    [PAGE, options] as const,
  );
}

const moved = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[style*="transform"]')].map((el) => el.id || el.tagName.toLowerCase()));

test.describe('gravity', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, [GRAVITY]);
  });

  test('drops text, media and cards, not the boxes around them', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => (window as unknown as Win).fx.drop());
    const ids = await moved(page);
    expect(ids).toEqual(expect.arrayContaining(['title', 'lead', 'go', 'link', 'card', 'art']));
    expect(ids).not.toContain('main');
    // The card falls whole, so its heading and text don't fall on their own.
    expect(ids).not.toContain('h3');
  });

  test('everything lands at the bottom of the viewport without changing the layout', async ({ page }) => {
    await setup(page);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.evaluate(() => (window as unknown as Win).fx.drop());
    const result = await page.evaluate(() => {
      const viewport = document.documentElement.clientHeight;
      const bottoms = ['title', 'lead', 'card', 'art'].map((id) => document.getElementById(id)!.getBoundingClientRect().bottom);
      return { viewport, bottoms, state: (window as unknown as Win).fx.state, height: document.documentElement.scrollHeight };
    });
    expect(result.state).toBe('falling');
    expect(result.height).toBe(height);
    for (const bottom of result.bottoms) {
      expect(bottom).toBeLessThanOrEqual(result.viewport + 2);
      expect(bottom).toBeGreaterThan(result.viewport * 0.6);
    }
  });

  test('restore puts the page back exactly as it was', async ({ page }) => {
    await setup(page, { splitText: 'words' });
    const before = await page.evaluate(() => document.body.innerHTML);
    await page.evaluate(() => (window as unknown as Win).fx.drop());
    const pieces = await page.evaluate(() => document.querySelectorAll('#lead [data-gravity-piece]').length);
    expect(pieces).toBe(7);
    await page.evaluate(() => (window as unknown as Win).fx.restore());
    expect(await page.evaluate(() => (window as unknown as Win).fx.state)).toBe('idle');
    expect(await page.evaluate(() => document.body.innerHTML)).toBe(before);
  });

  test('stops scheduling frames once everything rests', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => (window as unknown as Win).fx.drop());
    const before = await page.evaluate(() => (window as unknown as Win).__frames);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (window as unknown as Win).__frames)).toBeLessThanOrEqual(before + 1);
  });

  test('fallen elements can be dragged, and a drag never clicks', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => {
      (window as unknown as { clicks: number }).clicks = 0;
      document.getElementById('go')!.addEventListener('click', () => (window as unknown as { clicks: number }).clicks++);
      return (window as unknown as Win).fx.drop();
    });
    const box = (await page.locator('#go').boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 200, y - 250, { steps: 12 });
    await page.waitForTimeout(250);
    const held = (await page.locator('#go').boundingBox())!;
    expect(Math.abs(held.x + held.width / 2 - (x + 200))).toBeLessThan(40);
    expect(Math.abs(held.y + held.height / 2 - (y - 250))).toBeLessThan(40);
    await page.mouse.up();
    expect(await page.evaluate(() => (window as unknown as { clicks: number }).clicks)).toBe(0);
    // A plain click still works.
    await page.evaluate(() => (window as unknown as Win).fx.drop());
    await page.locator('#go').click();
    expect(await page.evaluate(() => (window as unknown as { clicks: number }).clicks)).toBe(1);
  });

  test('explode throws elements away from a point', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => (window as unknown as Win).fx.drop());
    const before = (await page.locator('#art').boundingBox())!;
    await page.evaluate(([x, y]) => void (window as unknown as Win).fx.explode({ x, y }, 1.5), [before.x + before.width / 2 + 20, before.y + before.height + 10]);
    await page.waitForTimeout(120);
    const after = (await page.locator('#art').boundingBox())!;
    expect(after.y).toBeLessThan(before.y - 20);
  });

  test('Escape puts everything back', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => (window as unknown as Win).fx.drop());
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => (window as unknown as Win).fx.state)).toBe('idle');
    expect(await moved(page)).toEqual([]);
  });

  test('the Konami code toggles it', async ({ page }) => {
    await setup(page, { trigger: 'konami' });
    const code = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
    for (const key of code) await page.keyboard.press(key);
    expect(await page.evaluate(() => (window as unknown as Win).fx.state)).toBe('falling');
    for (const key of code) await page.keyboard.press(key);
    await expect.poll(() => page.evaluate(() => (window as unknown as Win).fx.state)).toBe('idle');
  });

  test('falls by itself after the visitor is idle', async ({ page }) => {
    await setup(page, { trigger: { idle: 0.3 } });
    expect(await page.evaluate(() => (window as unknown as Win).fx.state)).toBe('idle');
    await expect.poll(() => page.evaluate(() => (window as unknown as Win).fx.state), { timeout: 3000 }).toBe('falling');
  });

  test('a click trigger toggles from a button', async ({ page }) => {
    await setup(page, { trigger: { click: '#go' } });
    await page.locator('#go').click();
    expect(await page.evaluate(() => (window as unknown as Win).fx.state)).toBe('falling');
  });

  test('does nothing when the user prefers reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setup(page, { trigger: 'load' });
    await page.evaluate(() => (window as unknown as Win).fx.drop());
    expect(await page.evaluate(() => (window as unknown as Win).fx.state)).toBe('idle');
    expect(await moved(page)).toEqual([]);
  });

  test('<fx-gravity> drops its contents and cleans up when removed', async ({ page }) => {
    const before = await page.evaluate(() => {
      document.body.innerHTML = '<div id="wrap"></div>';
      return document.body.innerHTML;
    });
    await page.evaluate(() => {
      const el = document.createElement('fx-gravity');
      el.setAttribute('trigger', 'konami');
      el.setAttribute('restore-duration', '0.1');
      el.style.height = '300px';
      el.innerHTML = '<p id="inside" style="margin:0">Falls inside the box</p>';
      document.getElementById('wrap')!.append(el);
    });
    const effect = await page.evaluate(() => (document.querySelector('fx-gravity') as any).effect.options);
    expect(effect.trigger).toBe('konami');
    expect(effect.restoreDuration).toBe(0.1);
    await page.evaluate(() => (document.querySelector('fx-gravity') as any).effect.drop());
    const landed = await page.evaluate(() => {
      const box = document.querySelector('fx-gravity')!.getBoundingClientRect();
      return document.getElementById('inside')!.getBoundingClientRect().bottom - box.bottom;
    });
    expect(Math.abs(landed)).toBeLessThan(3);
    await page.evaluate(() => document.querySelector('fx-gravity')!.remove());
    expect(await page.evaluate(() => document.body.innerHTML)).toBe(before);
  });
});
