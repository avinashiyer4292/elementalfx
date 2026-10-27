import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 1,
    launchOptions: {
      // Software WebGL so results match on machines without a GPU (CI runners).
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'node scripts/serve.mjs 4173',
    url: 'http://localhost:4173/tests/fixtures/blank.html',
    reuseExistingServer: !process.env.CI,
  },
});
