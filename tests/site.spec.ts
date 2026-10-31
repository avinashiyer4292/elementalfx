import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from 'playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// One worker builds _site once, then every test reads it.
test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  execFileSync(process.execPath, [resolve(root, 'scripts/site.mjs')], { cwd: root, stdio: 'ignore' });
});

async function visit(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  // Keep the test offline: fall back to local fonts.
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto('/_site/index.html');
}

test.describe('demo site', () => {
  test('every demo starts without errors', async ({ page }) => {
    const errors: string[] = [];
    await visit(page, errors);
    for (const id of ['ripples', 'weather', 'fluid']) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      await expect(page.locator(`#${id}-demo canvas`).first()).toBeAttached();
    }
    await expect(page.locator('#hero canvas')).toBeAttached();
    for (const id of ['ripples', 'weather', 'fluid', 'gravity', 'dissolve', 'react']) {
      await expect(page.locator(`#${id}-code`)).not.toBeEmpty();
    }
    expect(errors).toEqual([]);
  });

  test('presets switch and update the code sample', async ({ page }) => {
    const errors: string[] = [];
    await visit(page, errors);
    await page.locator('[data-group="weather"] [data-value="storm"]').click();
    await expect(page.locator('[data-group="weather"] [data-value="storm"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#weather-code')).toContainText("preset: 'storm'");
    await expect(page.locator('#weather-demo canvas')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('a dissolve card vanishes and comes back', async ({ page }) => {
    const errors: string[] = [];
    await visit(page, errors);
    const card = page.locator('.specimen[data-effect="fade"]');
    await card.scrollIntoViewIfNeeded();
    // It's hidden for well under a second, so record it rather than poll for it.
    await card.evaluate((el) => {
      const seen: string[] = [];
      (window as unknown as { seen: string[] }).seen = seen;
      new MutationObserver(() => seen.push(getComputedStyle(el).visibility)).observe(el, { attributes: true, attributeFilter: ['style'] });
    });
    await card.click();
    await expect.poll(() => card.getAttribute('data-busy'), { timeout: 10_000 }).toBe(null);
    expect(await page.evaluate(() => (window as unknown as { seen: string[] }).seen)).toContain('hidden');
    expect(await card.evaluate((el) => getComputedStyle(el).visibility)).toBe('visible');
    await expect(page.locator('#dissolve-code')).toContainText("effect: 'fade'");
    expect(errors).toEqual([]);
  });

  test('the gravity box drops and restores', async ({ page }) => {
    const errors: string[] = [];
    await visit(page, errors);
    await page.locator('#gravity-drop').click();
    await expect.poll(() => page.locator('#gravity-demo [style*="transform"]').count()).toBeGreaterThan(3);
    await page.locator('#gravity-restore').click();
    await expect.poll(() => page.locator('#gravity-demo [style*="transform"]').count()).toBe(0);
    expect(errors).toEqual([]);
  });

  test('fits a phone screen without sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    const errors: string[] = [];
    await visit(page, errors);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });
});
