import type { Locator, Page } from 'playwright/test';

/** Opens the blank fixture page and loads the given script bundles. */
export async function open(page: Page, scripts: string[]): Promise<void> {
  await page.goto('/tests/fixtures/blank.html');
  for (const src of scripts) {
    await page.evaluate((s) => (window as unknown as { loadScript(s: string): Promise<void> }).loadScript(s), src);
  }
}

/** Element screenshot as a PNG data URL. */
export async function shot(locator: Locator): Promise<string> {
  const buffer = await locator.screenshot({ animations: 'allow' });
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

/** Mean absolute per-channel difference (0–255) between two screenshots, computed in the page. */
export async function diff(page: Page, a: string, b: string): Promise<number> {
  return page.evaluate(
    ([x, y]) => (window as unknown as { imageDiff(a: string, b: string): Promise<number> }).imageDiff(x!, y!),
    [a, b],
  );
}

export async function frames(page: Page, count = 2): Promise<void> {
  await page.evaluate((n) => (window as unknown as { nextFrames(n: number): Promise<void> }).nextFrames(n), count);
}

export const RIPPLES = '/packages/ripples/dist/ripples.global.js';
