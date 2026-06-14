import { test, expect } from '@playwright/test';

/**
 * Public landing (guest at "/"). No auth, no API — it must render on its own.
 * Verifies the marketing page shows and its CTAs point at /register and /login.
 */
test('гість на "/" бачить лендінг; CTA ведуть на /register і /login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL('http://localhost:5173/');

  // Hero is the marketing page, not the app / a login redirect.
  await expect(page.getByRole('heading', { name: /Професійний кошторис/ })).toBeVisible();

  // Primary CTA → register; nav "Увійти" → login.
  const cta = page.getByRole('link', { name: 'Почати безкоштовно' }).first();
  await expect(cta).toHaveAttribute('href', '/register');
  await expect(page.getByRole('link', { name: 'Увійти' })).toHaveAttribute('href', '/login');

  // Support contacts (from config/env) are real, clickable links in the footer.
  await expect(
    page.getByRole('link', { name: 'support@majstr.pro' }),
  ).toHaveAttribute('href', 'mailto:support@majstr.pro');

  // Clicking the CTA actually routes to registration.
  await cta.click();
  await expect(page).toHaveURL(/\/register$/);
});
