import { test, expect } from '@playwright/test';

/**
 * The service-worker guarantee, and NOTHING else — so it needs no backend and no login.
 *
 * This is the exact failure a master reported: offline, a refresh on a deep route showed the
 * browser's "Ви не в мережі" page. The cause was `sw.ts` precaching assets but registering no
 * NavigationRoute, so `/projects/123` matched nothing and fell through to the (absent) network.
 * The regular e2e suite runs on the Vite dev server, where the service worker is DISABLED — which
 * is why nothing caught it. This test runs against a production build.
 */
test('офлайн: глибокий маршрут відкриває застосунок, а не сторінку помилки браузера', async ({
  page,
  context,
}) => {
  // 1 — first visit online so the service worker installs and precaches the shell.
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, {
    timeout: 30_000,
  });

  // 2 — cut the network and open a route that is NOT in the precache manifest.
  await context.setOffline(true);
  await page.goto('/projects/00000000-0000-0000-0000-000000000000');

  // 3 — the app shell must render. Not logged in → the login page; the point is that OUR app
  //     answered at all (the browser's offline page has no #root and no app markup).
  await expect(page.locator('#root')).not.toBeEmpty({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Увійти' })).toBeVisible({ timeout: 20_000 });
});
