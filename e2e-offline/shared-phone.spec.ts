import { test, expect, type Page } from '@playwright/test';

/**
 * A crew shares one phone. Master A's session dies with unsynced work in the queue, and master B
 * registers on that phone. A's work must never be sent as B, and until B exists a visitor on a public
 * page must not be thrown to /login by a replay nobody asked for. Needs the backend, like journey.spec.
 */

async function register(page: Page, label: string): Promise<void> {
  await page.goto('/register');
  await page.fill('#email', `e2e-phone+${label}${Date.now()}@majstr.test`);
  await page.fill('#password', 'Test1234!');
  await page.fill('#fullName', `Майстер ${label}`);
  await page.locator('input[type="checkbox"][value="ELECTRICAL"]').check();
  await page.fill('#phone', '+380501112233');
  await page.fill('#companyName', `ФОП ${label}`);
  await page.locator('input[name="consent"]').check();
  await page.getByRole('button', { name: 'Створити акаунт' }).click();
  await expect(page).not.toHaveURL(/\/register/, { timeout: 20_000 });
}

test('чужа черга не йде в новий акаунт, а відвідувача не викидає на логін', async ({ page, context }) => {
  await register(page, 'A');
  await page.getByRole('button', { name: "Новий об'єкт" }).first().click();
  await page.fill('#pr-name', 'Обʼєкт майстра А');
  await page.fill('#pr-addr', 'вул. Тестова 7');
  await page.getByRole('button', { name: 'Створити обʼєкт' }).click();
  await page.getByRole('button', { name: 'Порожній кошторис' }).click();
  await expect(page).toHaveURL(/\/estimates\//);
  await page.goto('/projects');
  await page.getByText('Обʼєкт майстра А').first().click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/);
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30_000 });
  await page.waitForTimeout(3000); // the background prefetch warms the cache

  // A authors offline, so the create waits in the queue.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Офлайн', { timeout: 20_000 });
  await page.getByRole('button', { name: '＋ Новий кошторис' }).click();
  await page.getByRole('button', { name: 'Порожній кошторис' }).click();
  await expect(page.getByRole('status')).toContainText('Не синхронізовано', { timeout: 20_000 });

  // The session dies while the work is still queued.
  await page.evaluate(() => {
    localStorage.removeItem('majstr.accessToken');
    localStorage.removeItem('majstr.refreshToken');
  });

  const replayed: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/api\/projects\/[^/]+\/estimates/.test(request.url())) {
      replayed.push(request.url());
    }
  });

  // Signal comes back with nobody signed in: a stranger on /register stays on /register.
  await context.setOffline(false);
  await page.goto('/register');
  await page.waitForTimeout(3000);
  await expect(page).toHaveURL(/\/register/);
  expect(replayed).toEqual([]);

  await register(page, 'B');
  await page.waitForTimeout(3000);

  expect(replayed).toEqual([]);
  await page.goto('/projects');
  await expect(page.getByText('Обʼєкт майстра А')).toHaveCount(0);
});
