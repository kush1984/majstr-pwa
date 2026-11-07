import { expect, type Page } from '@playwright/test';

/**
 * Registration asks for email, password and consent only (V190); the trades are the first screen
 * inside. Every journey that registers passes through it here, picking the trades by their Ukrainian
 * label, then lands home.
 */
export async function passTradesScreen(page: Page, labels: string[], timeout = 25_000): Promise<void> {
  await expect(page).toHaveURL(/\/welcome$/, { timeout });
  for (const label of labels) {
    await page.getByRole('button', { name: new RegExp(label) }).click();
  }
  await page.getByRole('button', { name: 'Далі' }).click();
  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/$/, { timeout });
}

/** The register form as it is now: three fields. */
export async function fillRegister(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/register');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.locator('input[name="consent"]').check(); // the privacy consent gate (no id on it)
}
