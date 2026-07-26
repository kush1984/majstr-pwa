import { defineConfig, devices } from '@playwright/test';

/**
 * Offline E2E — deliberately a SEPARATE config, because it must run against a PRODUCTION build.
 *
 * The regular suite runs on the Vite dev server, where the service worker is disabled
 * (`devOptions.enabled: false` in vite.config). Every offline guarantee we care about — the app
 * shell booting with no network, a deep route surviving a refresh — lives in that service worker,
 * so a dev-server test would happily pass while production is broken. That is exactly how the
 * "Ви не в мережі" bug reached a real master: nothing in the dev-based suite could see it.
 *
 * Run: `npm run test:e2e:offline`. Two prerequisites, both of which fail confusingly if missed:
 *
 *  1. **The backend must be up on :8080** (shell.spec does not need it; journey.spec does).
 *  2. **:4173 must be in the backend's CORS allow-list.** This suite serves the built bundle
 *     from `vite preview` on :4173 while the dev server uses :5173, and the production build
 *     has no Vite proxy — so the app calls :8080 cross-origin. Without the origin allowed, the
 *     preflight is refused, registration silently does nothing, and the test times out staring
 *     at a filled-in form. `application.yml` now ships :4173 in the default list, but a local
 *     `CORS_ALLOWED_ORIGINS` env var REPLACES that list rather than extending it.
 *  3. Browsers must be installed: `npx playwright install chromium`.
 */
export default defineConfig({
  testDir: './e2e-offline',
  // No globalSetup: shell.spec needs NO backend (it only exercises the service worker).
  // journey.spec does need it and says so.
  timeout: 120_000, // includes a production build on first run
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'uk-UA',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // `vite preview` serves the real build — service worker included.
    command: 'npm run build && npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
