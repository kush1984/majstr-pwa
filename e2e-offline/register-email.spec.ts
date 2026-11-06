import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * The registration door on a phone, on the production build. On 2026-11-06 three people filled the whole
 * form and pressed «Створити акаунт» ten times between them: the server refused the address, the refusal
 * was written under the email field a screen above the button, and the press looked like it did nothing.
 * These pin what fixed it: the field comes back on screen with the cursor in it, and a typo in the domain
 * is offered its fix before anything is sent. Needs no backend: /api/auth/register is answered here, so CI
 * runs it on every push.
 */

test.use({ serviceWorkers: 'block', viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };

/** Every address the form sent, answered with `reply(n)` for the n-th registration (0-based). */
async function answerRegistration(page: Page, reply: (n: number) => { status: number; code: string; message: string }) {
  const sent: string[] = [];
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    if (request.method() === 'POST' && request.url().includes('/api/auth/register')) {
      const { status, code, message } = reply(sent.length);
      sent.push((request.postDataJSON() as { email: string }).email);
      await route.fulfill({ status, headers: CORS, json: { status, code, message } });
      return;
    }
    await route.fulfill({ status: 204, headers: CORS });
  });
  return sent;
}

async function fillAllButEmail(page: Page): Promise<void> {
  await page.fill('#password', 'Test1234!');
  await page.fill('#fullName', 'Іван Петренко');
  await page.locator('input[type="checkbox"][value="TILING"]').check();
  await page.fill('#phone', '+380501112233');
  await page.locator('input[name="consent"]').check();
}

const TAKEN = { status: 409, code: 'EMAIL_ALREADY_REGISTERED', message: 'Цей email вже зареєстрований' };
const THROWAWAY = {
  status: 400,
  code: 'EMAIL_DISPOSABLE',
  message: 'Тимчасова пошта не підійде: на неї прийде лист для підтвердження. Вкажіть пошту, яку ви читаєте.',
};
const TYPO = {
  status: 400,
  code: 'EMAIL_NO_MAIL',
  message: 'Схоже, в адресі помилка: на цей домен пошта не приходить. Перевірте, що написано після @.',
};

test('описка в домені: одне натискання виправляє, і на сервер іде виправлена адреса', async ({ page }) => {
  const sent = await answerRegistration(page, () => TAKEN);
  await page.goto('/register');

  await page.fill('#email', 'ivan@gmal.com');
  await page.locator('#password').focus(); // leaving the field is when the hint is offered
  await page.getByRole('button', { name: 'Може, ivan@gmail.com?' }).click();

  await expect(page.locator('#email')).toHaveValue('ivan@gmail.com');
  await expect(page.getByRole('button', { name: /^Може,/ })).toHaveCount(0);
  await fillAllButEmail(page);
  await page.getByRole('button', { name: 'Створити акаунт' }).click();
  await expect.poll(() => sent).toEqual(['ivan@gmail.com']);
});

test('справжній домен підказки не отримує', async ({ page }) => {
  await answerRegistration(page, () => TAKEN);
  await page.goto('/register');

  await page.fill('#email', 'ivan@ukr.net');
  await page.locator('#password').focus();

  await expect(page.getByRole('button', { name: /^Може,/ })).toHaveCount(0);
});

test('сервер відмовив у пошті: на телефоні поле повертається на екран, з курсором у ньому', async ({ page }) => {
  const sent = await answerRegistration(page, () => THROWAWAY);
  await page.goto('/register');
  await page.fill('#email', 'ivan@yopmail.com');
  await fillAllButEmail(page);

  const create = page.getByRole('button', { name: 'Створити акаунт' });
  await create.scrollIntoViewIfNeeded();
  // The situation that cost the registrations: at the button, the email field is off the screen.
  await expect(page.locator('#email')).not.toBeInViewport();
  await create.click();

  await expect(page.getByText(THROWAWAY.message)).toBeVisible();
  await expect(page.locator('#email')).toBeFocused();
  await expect(page.locator('#email')).toBeInViewport();
  expect(sent).toEqual(['ivan@yopmail.com']);
});

test('сервер сказав «описка»: підказка з’являється сама, і друга спроба йде з виправленою адресою', async ({ page }) => {
  const sent = await answerRegistration(page, (n) => (n === 0 ? TYPO : TAKEN));
  await page.goto('/register');
  await page.fill('#email', 'ivan@gmal.com');
  await fillAllButEmail(page);
  await page.getByRole('button', { name: 'Створити акаунт' }).click();

  await expect(page.getByText(TYPO.message)).toBeVisible();
  await expect(page.locator('#email')).toBeInViewport();
  await page.getByRole('button', { name: 'Може, ivan@gmail.com?' }).click();
  await expect(page.getByText(TYPO.message)).toHaveCount(0);
  await page.getByRole('button', { name: 'Створити акаунт' }).click();

  await expect.poll(() => sent).toEqual(['ivan@gmal.com', 'ivan@gmail.com']);
});
