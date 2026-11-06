import { test, expect, type Page } from '@playwright/test';

/**
 * The registration door against the real server, on a phone: a refused address is seen, corrected, and
 * the account is created. Unlike `e2e-offline/register-email.spec.ts` nothing is answered by the test —
 * the code and the words come from the backend's own email policy (the dev profile keeps the blocklist
 * and switches the DNS check off, which is why the correction can land on @majstr.test).
 */

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

async function fillAllButEmail(page: Page): Promise<void> {
  await page.fill('#password', 'Test1234!');
  await page.fill('#fullName', 'Майстер Реєстрація');
  await page.locator('input[type="checkbox"][value="TILING"]').check();
  await page.fill('#phone', '+380501112233');
  await page.locator('input[name="consent"]').check();
}

test('тимчасову пошту відхилено, людина її бачить і виправляє — і реєструється', async ({ page }) => {
  await page.goto('/register');
  await page.fill('#email', `e2e-reg+${Date.now()}@yopmail.com`);
  await fillAllButEmail(page);

  const create = page.getByRole('button', { name: 'Створити акаунт' });
  await create.scrollIntoViewIfNeeded();
  await create.click();

  await expect(page.getByText('Тимчасова пошта не підійде')).toBeVisible();
  await expect(page.locator('#email')).toBeFocused();
  await expect(page.locator('#email')).toBeInViewport();
  await expect(page).toHaveURL(/\/register/);

  await page.fill('#email', `e2e-reg+${Date.now()}@majstr.test`);
  await page.getByRole('button', { name: 'Створити акаунт' }).click();

  await expect(page).not.toHaveURL(/\/register/, { timeout: 20_000 });
});

test('описку в домені виправляє підказка, і з виправленою адресою акаунт створюється', async ({ page }) => {
  const local = `e2e-reg-hint+${Date.now()}`;
  await page.goto('/register');
  await page.fill('#email', `${local}@gmal.com`);
  await page.locator('#password').focus();
  await page.getByRole('button', { name: `Може, ${local}@gmail.com?` }).click();
  await expect(page.locator('#email')).toHaveValue(`${local}@gmail.com`);
  await fillAllButEmail(page);

  const registered = page.waitForResponse(
    (response) => response.url().includes('/api/auth/register') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Створити акаунт' }).click();

  expect((await registered).status()).toBe(201);
  await expect(page).not.toHaveURL(/\/register/, { timeout: 20_000 });
});
