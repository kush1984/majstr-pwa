import { test, expect, type Route } from '@playwright/test';

/**
 * A phone on one bar: the socket under `/api/auth/refresh` hangs and never answers. Every bearer request
 * and the outbox wait for that call, so without a ceiling on it the app sat on spinners until the master
 * killed it. Unit tests can only see the `timeout` option being passed; this watches a real browser give
 * up, keep the session, and try again. Needs no backend: everything under /api is answered here.
 */

test.use({ serviceWorkers: 'block' });

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };

function jwt(exp: number): string {
  return `header.${Buffer.from(JSON.stringify({ exp, sub: 'u-1' })).toString('base64')}.signature`;
}

test('завислий /refresh не тримає застосунок і не викидає майстра', async ({ page, context }) => {
  const expired = jwt(Math.floor(Date.now() / 1000) - 3600);
  await context.addInitScript(([access]) => {
    if (!localStorage.getItem('majstr.refreshToken')) {
      localStorage.setItem('majstr.accessToken', access);
      localStorage.setItem('majstr.refreshToken', 'refresh-old');
    }
  }, [expired]);

  let refreshCalls = 0;
  const stalled: Route[] = [];
  await page.route('**/api/**', async (route) => {
    if (route.request().url().includes('/api/auth/refresh')) {
      refreshCalls += 1;
      if (refreshCalls === 1) {
        stalled.push(route); // never answered, which is the whole scenario
        return;
      }
      await route.fulfill({
        headers: CORS,
        json: { accessToken: jwt(Math.floor(Date.now() / 1000) + 3600), refreshToken: 'refresh-new' },
      });
      return;
    }
    await route.fulfill({ status: 503, headers: CORS, json: { message: 'test' } });
  });

  const gaveUp = page.waitForEvent('requestfailed', {
    predicate: (request) => request.url().includes('/api/auth/refresh'),
    timeout: 25_000,
  });
  const startedAt = Date.now();
  await page.goto('/');
  await expect.poll(() => refreshCalls).toBe(1);
  await gaveUp;

  // Not at once, and not never: the ceiling is 15 s.
  expect(Date.now() - startedAt).toBeGreaterThan(13_000);

  // The session outlived the stall.
  await expect(page).not.toHaveURL(/\/login/);
  expect(await page.evaluate(() => localStorage.getItem('majstr.refreshToken'))).toBe('refresh-old');

  // And the next request is free to try again, rather than waiting on the dead one.
  await page.reload();
  await expect.poll(() => refreshCalls, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('majstr.refreshToken')), { timeout: 10_000 })
    .toBe('refresh-new');
  expect(stalled).toHaveLength(1);
});
