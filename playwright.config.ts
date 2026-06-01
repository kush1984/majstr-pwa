import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config for the Majstr PWA.
 *
 * Assumes the Spring Boot backend is already running on http://localhost:8080
 * (Playwright can't start the Java app) — `global-setup.ts` checks that and
 * fails fast with a clear message if it's down. The Vite dev server is started
 * automatically (or reused if you already have one on 5173).
 *
 * Run: `npm run test:e2e`  ·  Debug UI: `npm run test:e2e:ui`
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1, // one flow at a time — shared backend + DB
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'uk-UA',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
