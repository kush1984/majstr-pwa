import { test, expect } from '@playwright/test';

/**
 * Reliability / error-handling flow (BLOCK 1).
 *
 * Simulates the backend being unreachable for the projects list and asserts the
 * user sees a friendly error screen (not a blank area / raw error) with a working
 * "try again" that recovers once the backend is back. The auth + dashboard
 * shell still load against the real backend on :8080.
 *
 * Timeouts here are generous on purpose: this is the first spec (alphabetical),
 * so it pays the cold-Vite compile cost on `npm run test:e2e`.
 */
test('backend недоступний → дружній екран помилки + retry відновлює', async ({ page }) => {
  const email = `e2e-rel+${Date.now()}@majstr.test`;

  // Knock out only the GET projects list. Network-level abort = "backend down".
  let failProjects = true;
  await page.route(/\/api\/projects(\?.*)?$/, async (route) => {
    if (route.request().method() === 'GET' && failProjects) {
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  // Register → auto-login → dashboard (its recent-projects load will fail).
  await page.goto('/register');
  await page.fill('#email', email);
  await page.fill('#password', 'Test1234!');
  await page.fill('#fullName', 'Релі Тест');
  await page.locator('input[type="checkbox"][value="ELECTRICAL"]').check();
  await page.fill('#phone', '+380501119999');
  await page.fill('#companyName', 'Релі ФОП');
  await page.getByRole('button', { name: 'Створити акаунт' }).click();

  await expect(page).toHaveURL('http://localhost:5173/', { timeout: 25_000 });

  // Friendly error state appears after the network retries/backoff are exhausted.
  await expect(page.getByText('Сервіс тимчасово недоступний')).toBeVisible({ timeout: 20_000 });
  const retry = page.getByRole('button', { name: 'Спробувати знову' });
  await expect(retry).toBeVisible();

  // Backend recovers; the manual retry refetches and the error clears.
  failProjects = false;
  await retry.click();
  await expect(page.getByText('Сервіс тимчасово недоступний')).toBeHidden({ timeout: 15_000 });
});
