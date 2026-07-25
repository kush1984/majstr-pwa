import { test, expect, type Page } from '@playwright/test';

/**
 * The offline guarantee, walked exactly as a master on a no-signal site would:
 * open an object → lose the network → REFRESH → keep working → regain the network → it syncs.
 *
 * This is the regression net for two bugs that reached production because unit tests structurally
 * cannot see them:
 *  1. the service worker had no navigation fallback, so a refresh on a deep route showed the
 *     browser's "Ви не в мережі" page;
 *  2. queries/mutations PAUSED offline instead of resolving, so the app hung on a spinner.
 * Both only appear in a real browser, against a real production build, with the network cut.
 */

/** Wait until the service worker actually controls the page — before that, offline is undefined. */
async function waitForServiceWorker(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, {
    timeout: 30_000,
  });
}

async function registerAndSeed(page: Page): Promise<{ projectUrl: string }> {
  const email = `e2e-offline+${Date.now()}@majstr.test`;
  await page.goto('/register');
  await page.fill('#email', email);
  await page.fill('#password', 'Test1234!');
  await page.fill('#fullName', 'Офлайн Тест');
  await page.locator('input[type="checkbox"][value="ELECTRICAL"]').check();
  await page.fill('#phone', '+380501112233');
  await page.fill('#companyName', 'Офлайн ФОП');
  await page.getByRole('button', { name: 'Створити акаунт' }).click();

  // Create an object + estimate so there is real data to see offline.
  await page.getByRole('button', { name: 'Створити перший кошторис' }).click();
  await page.fill('#pr-name', 'Обʼєкт Офлайн');
  await page.fill('#pr-addr', 'вул. Тестова 7');
  await page.getByRole('button', { name: 'Створити кошторис' }).click();
  await expect(page).toHaveURL(/\/estimates\//);

  // Land on the object page — the deep route whose refresh used to die offline.
  await page.goto('/projects');
  await page.getByText('Обʼєкт Офлайн').first().click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/);
  return { projectUrl: page.url() };
}

test('офлайн: рефреш на глибокому маршруті + робота + синк при поверненні мережі', async ({
  page,
  context,
}) => {
  const { projectUrl } = await registerAndSeed(page);
  await waitForServiceWorker(page);
  // Give the background prefetch a moment to warm the cache (it runs once logged in + online).
  await page.waitForTimeout(3000);

  // ---- 1. Go offline and RELOAD the deep route -----------------------------
  await context.setOffline(true);
  await page.reload();

  // The app shell must boot from the service worker — NOT the browser's offline page.
  await expect(page.getByRole('status')).toContainText('Офлайн', { timeout: 20_000 });
  // And the master's own data must still be here, from the persisted cache.
  await expect(page.getByText('Обʼєкт Офлайн')).toBeVisible();
  // Nothing may hang on a spinner: the page reached a real, terminal state.
  await expect(page.locator('text=Сервіс тимчасово недоступний')).toHaveCount(0);

  // ---- 2. The login page must render offline too ---------------------------
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Увійти' })).toBeVisible({ timeout: 20_000 });

  // ---- 3. Author something offline → it queues ------------------------------
  await page.goto(projectUrl);
  await page.getByRole('button', { name: 'Новий кошторис' }).click().catch(() => undefined);
  // The sync banner must show pending work (the outbox picked the write up).
  await expect(page.getByRole('status')).toContainText(/Очікують синхронізації|Офлайн/, {
    timeout: 20_000,
  });

  // ---- 4. Back online → the queue drains ------------------------------------
  await context.setOffline(false);
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 30_000 });
});
