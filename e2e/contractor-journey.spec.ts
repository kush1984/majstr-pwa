import { test, expect, type Page } from '@playwright/test';

/**
 * Deeper contractor-journey coverage derived from the manual prod scenario
 * (E2E-TEST-SCENARIO.md). Automates the parts that run against the local
 * backend with no external dependencies:
 *   - Step 3  — new-user dashboard shows honest 0-metrics (not an error) + FREE plan + trades
 *   - Step 5  — catalog is seeded at registration; a manual item can be added
 *   - Step 6  — manual estimate items (work + material) and the total recomputes correctly
 *   - Step 13 — the FREE object limit (2) blocks creating a 3rd object, friendly toast
 *
 * NOT automated here (need real infra / live prod, or live in majstr-backend):
 *   email verification (Resend), PDF cyrillic+logo render, the client portal +
 *   signing, web-push delivery, signed-estimate immutability (needs a signature),
 *   admin. Those stay in the manual scenario.
 *
 * ⚠️ Registration budget: the backend rate-limits POST /api/auth/register to
 * **5/hour/IP** (Fix I). The whole suite registers a few fresh users
 * (this spec 2 + smoke 1 + reliability 1 = 4), so ONE clean run fits — but
 * several reruns within the same hour will hit 429. Restart the backend to
 * reset the in-memory bucket, or relax the limit in the backend dev profile.
 * That's why the read-only checks below share a SINGLE registration.
 */

const PASSWORD = 'Test1234!';

async function registerMaster(page: Page, label: string): Promise<string> {
  const email = `e2e-${label}+${Date.now()}@majstr.test`;
  await page.goto('/register');
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.fill('#fullName', 'Журі Тестовий');
  await page.locator('input[type="checkbox"][value="ELECTRICAL"]').check();
  await page.fill('#phone', '+380501110000');
  await page.fill('#companyName', 'Журі ФОП');
  await page.getByRole('button', { name: 'Створити акаунт' }).click();
  // Generous timeout: the first spec alphabetically pays the cold-Vite compile.
  await expect(page).toHaveURL('http://localhost:5173/', { timeout: 25_000 });
  return email;
}

/** Inline new-client + new-object → creates an estimate and opens the editor. */
async function createEstimate(
  page: Page,
  client: string,
  phone: string,
  obj: string,
  addr: string,
): Promise<void> {
  await page.goto('/new');
  await expect(page).toHaveURL(/\/new$/);
  await page.getByRole('button', { name: '+ Новий клієнт' }).click();
  await page.fill('#nc-name', client);
  await page.fill('#nc-phone', phone);
  await page.fill('#pr-name', obj);
  await page.fill('#pr-addr', addr);
  await page.getByRole('button', { name: 'Створити кошторис' }).click();
}

/** Open the add-item sheet, switch to the manual tab, fill it, submit. */
async function addManualItem(
  page: Page,
  item: { name: string; type: 'WORK' | 'MATERIAL'; unit: string; qty: string; price: string },
): Promise<void> {
  await page.getByRole('button', { name: '+ Додати позицію' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Додати позицію' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Вручну' }).click();
  await dialog.locator('#it-name').fill(item.name);
  await dialog.locator('#it-type').selectOption(item.type);
  await dialog.locator('#it-unit').selectOption(item.unit);
  await dialog.locator('#it-qty').fill(item.qty);
  await dialog.locator('#it-price').fill(item.price);
  await dialog.getByRole('button', { name: 'Додати', exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** The backend-computed total, reduced to its digits (currency/spacing-agnostic). */
async function totalDigits(page: Page): Promise<string> {
  const txt = await page.getByTestId('estimate-total').first().innerText();
  return txt.replace(/\D/g, '');
}

// One registration, one journey: dashboard honesty → profile plan → catalog →
// estimate with manual items + correct totals (Steps 3, 5, 6).
test('новий майстер: чесний дашборд + FREE-план + каталог + кошторис із сумою', async ({
  page,
}) => {
  await registerMaster(page, 'journey');

  // Step 3 — dashboard metric cards render the honest zero state, NOT an error.
  await expect(page.getByText('Не вдалося завантажити показники')).toHaveCount(0);
  await expect(page.getByText('Активних')).toBeVisible();
  await expect(page.getByText('Очікує')).toBeVisible();
  await expect(page.getByText('Електрика').first()).toBeVisible(); // chosen trade

  // Step 3 — profile shows FREE plan + "0 з 2" object limit + the trade.
  await page.goto('/profile');
  await expect(page.getByText('FREE', { exact: true })).toBeVisible(); // plan card, not "План FREE"
  await expect(page.getByText('0 з 2')).toBeVisible();
  await expect(page.getByText('Електрика').first()).toBeVisible();

  // Step 7 (PWA part) — company logo upload → preview → delete. Available on
  // FREE (brands the client portal). A 1×1 PNG passes the backend magic-byte
  // check. The file input is hidden; setInputFiles drives it directly.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: png,
  });
  // Upload succeeded → preview + replace/delete controls appear.
  await expect(page.locator('img[alt="Логотип компанії"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Замінити' })).toBeVisible();
  // Delete it → back to the upload affordance.
  await page.getByRole('button', { name: 'Видалити' }).first().click();
  await page
    .getByRole('dialog', { name: 'Видалити логотип?' })
    .getByRole('button', { name: 'Видалити' })
    .click();
  await expect(page.getByRole('button', { name: 'Завантажити' })).toBeVisible();

  // Step 5 — catalog is seeded at registration; a manual item can be added.
  await page.goto('/catalog');
  await expect(page.getByText('Каталог порожній')).toHaveCount(0);
  const catName = `Е2Е Позиція ${Date.now()}`;
  await page.getByRole('button', { name: '+ Додати позицію' }).first().click();
  const catDialog = page.getByRole('dialog', { name: 'Нова позиція' });
  await expect(catDialog).toBeVisible();
  await catDialog.locator('#ci-name').fill(catName);
  await catDialog.locator('#ci-price').fill('999');
  await catDialog.getByRole('button', { name: 'Додати', exact: true }).click();
  await expect(catDialog).toBeHidden();
  await expect(page.getByText(catName)).toBeVisible();

  // Step 6 — new estimate + manual items; the backend total recomputes.
  await createEstimate(page, 'Клієнт Сум', '+380671112233', "Об'єкт Сум", 'вул. Сумна 1');
  await expect(page).toHaveURL(/\/estimates\//);
  await expect(page.getByText('Кошторис порожній')).toBeVisible();

  // Autocomplete: typing part of a catalog item's name suggests it; picking the
  // suggestion fills the unit + price (the just-added catalog item, 999/шт).
  await page.getByRole('button', { name: '+ Додати позицію' }).first().click();
  const addSheet = page.getByRole('dialog', { name: 'Додати позицію' });
  await addSheet.getByRole('button', { name: 'Вручну' }).click();
  await addSheet.locator('#it-name').fill('Е2Е Позиція');
  const suggestion = addSheet.locator('li[role="option"]').filter({ hasText: catName });
  await expect(suggestion).toBeVisible();
  await suggestion.locator('button').click();
  await expect(addSheet.locator('#it-price')).toHaveValue('999');
  await page.keyboard.press('Escape'); // close the sheet without adding
  await expect(addSheet).toBeHidden();

  // Work 2 × 1500 = 3000.
  await addManualItem(page, { name: 'Демонтаж стін', type: 'WORK', unit: 'M2', qty: '2', price: '1500' });
  await expect(page.getByText('Демонтаж стін')).toBeVisible();
  expect(await totalDigits(page)).toBe('3000');

  // Material 3 × 500 = 1500 → total 4500.
  await addManualItem(page, { name: 'Клей плитковий', type: 'MATERIAL', unit: 'KG', qty: '3', price: '500' });
  await expect(page.getByText('Клей плитковий')).toBeVisible();
  expect(await totalDigits(page)).toBe('4500');
});

// Separate user — the FREE limit must be measured from a pristine 0-object account.
test('FREE-ліміт: створення 3-го обʼєкта заблоковано (FREE = 2)', async ({ page }) => {
  await registerMaster(page, 'limit');

  // First two objects create fine.
  await createEstimate(page, 'Клієнт A', '+380670000001', "Об'єкт 1", 'вул. Перша 1');
  await expect(page).toHaveURL(/\/estimates\//);
  await createEstimate(page, 'Клієнт B', '+380670000002', "Об'єкт 2", 'вул. Друга 2');
  await expect(page).toHaveURL(/\/estimates\//);

  // The 3rd hits the FREE limit: a friendly toast, and we stay on /new (no editor).
  await page.goto('/new');
  await page.getByRole('button', { name: '+ Новий клієнт' }).click();
  await page.fill('#nc-name', 'Клієнт C');
  await page.fill('#nc-phone', '+380670000003');
  await page.fill('#pr-name', "Об'єкт 3");
  await page.fill('#pr-addr', 'вул. Третя 3');
  await page.getByRole('button', { name: 'Створити кошторис' }).click();

  await expect(page.getByRole('status')).toBeVisible(); // friendly error toast
  await expect(page).toHaveURL(/\/new$/); // not navigated into an editor
});
