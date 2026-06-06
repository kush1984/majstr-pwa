import { test, expect } from '@playwright/test';

/**
 * The contractor happy path — the same journey we walk by hand:
 * register → dashboard → new estimate (inline client + object) →
 * add a catalog item → totals recompute in ₴ → PRO feature-gate.
 *
 * Registers a fresh user each run (unique email), so it's repeatable
 * without fixture cleanup. Needs the backend up on :8080.
 */
test('повний сценарій підрядника: реєстрація → кошторис → позиція → share', async ({
  page,
}) => {
  const email = `e2e+${Date.now()}@majstr.test`;

  // 1 — Register (also exercises the multi-trade checkboxes from Fix A)
  await page.goto('/register');
  await page.fill('#email', email);
  await page.fill('#password', 'Test1234!');
  await page.fill('#fullName', 'Е2Е Тестовий');
  await page.locator('input[type="checkbox"][value="ELECTRICAL"]').check();
  await page.locator('input[type="checkbox"][value="TILING"]').check();
  await page.fill('#phone', '+380501112233');
  await page.fill('#companyName', 'Е2Е ФОП');
  await page.getByRole('button', { name: 'Створити акаунт' }).click();

  // 2 — Dashboard (new user → teaching empty state)
  await expect(page).toHaveURL('http://localhost:5173/');
  await expect(page.getByText('Е2Е', { exact: false }).first()).toBeVisible();
  const startCta = page.getByRole('button', { name: 'Створити перший кошторис' });
  await expect(startCta).toBeVisible();

  // 3 — New-estimate flow with inline client + object creation
  await startCta.click();
  await expect(page).toHaveURL(/\/new$/);
  await page.getByRole('button', { name: '+ Новий клієнт' }).click();
  await page.fill('#nc-name', 'Олена Е2Е');
  await page.fill('#nc-phone', '+380671234567');
  await page.fill('#pr-name', 'Ванна Е2Е');
  await page.fill('#pr-addr', 'вул. Тестова 1');
  await page.getByRole('button', { name: 'Створити кошторис' }).click();

  // 4 — Editor opens on the freshly created estimate
  await expect(page).toHaveURL(/\/estimates\//);
  await expect(page.getByText('Кошторис порожній')).toBeVisible();

  // 5 — Add a line item from the starter catalog (seeded at registration)
  await page.getByRole('button', { name: '+ Додати позицію' }).click();
  const firstCatalogRow = page.getByTestId('catalog-row').first();
  await expect(firstCatalogRow).toBeVisible();
  await firstCatalogRow.click();
  await page.fill('#pick-qty', '5');
  await page.getByRole('button', { name: 'Додати', exact: true }).click();

  // 6 — Backend recomputed the total; it shows ₴ and is no longer zero
  const total = page.getByTestId('estimate-total').first();
  await expect(total).toBeVisible();
  await expect(total).toContainText('₴');
  await expect(total).not.toHaveText(/^0\s*₴$/);

  // 7 — Sharing opens a sheet with options; triggering "copy link" gives clear
  // feedback, never a silent failure. Tolerant of every policy outcome: a copied
  // link, the verify-email gate (unverified contractor), or the PRO gate.
  await page.getByRole('button', { name: /Поділитися/ }).first().click();
  await expect(page.getByRole('dialog', { name: 'Поділитися з клієнтом' })).toBeVisible();
  await page.getByRole('button', { name: /Копіювати посилання/ }).click();
  await expect(
    page
      .getByText(/Посилання скопійовано|доступний у плані PRO/)
      .or(page.getByRole('dialog', { name: 'Підтвердіть email' })),
  ).toBeVisible();

  // 8 — Profile edit (#16): the modal opens prefilled with the current data.
  // (UI only — the backend PUT /api/profile is still in progress, so we don't
  // submit here; this just guards the form renders and is wired up.)
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Редагувати профіль' }).click();
  const editDialog = page.getByRole('dialog', { name: 'Редагувати профіль' });
  await expect(editDialog).toBeVisible();
  // First textbox is the prefilled full-name field.
  await expect(editDialog.getByRole('textbox').first()).toHaveValue('Е2Е Тестовий');
  await editDialog.getByRole('button', { name: 'Скасувати' }).click();
  await expect(editDialog).not.toBeVisible();

  // 9 — Logout (Fix G): clicking "Вийти" revokes the session server-side
  // (POST /api/auth/logout, fire-and-forget) then routes to /login. After that
  // the protected route no longer opens — the token is cleared.
  await page.getByRole('button', { name: 'Вийти' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});
