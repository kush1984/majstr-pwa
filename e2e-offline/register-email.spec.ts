import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * The registration door on a phone, on the production build. On 2026-11-06 three people filled the whole
 * form and pressed «Створити акаунт» ten times between them: the server refused the address, the refusal
 * was written under the email field a screen above the button, and the press looked like it did nothing.
 * These pin what fixed it: the field comes back on screen with the cursor in it, and a typo in the domain
 * is offered its fix before anything is sent. Needs no backend: /api/auth/register is answered here, so CI
 * runs it on every push.
 *
 * Since V190 the door asks for email, password and consent only, and what used to follow on the form —
 * the trades — is the first screen inside («Чим займаєтесь?»). Both halves are pinned below.
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
  // The situation that cost the registrations was the email field off the screen at the button. The
  // three-field form (V190) keeps it close; what is pinned is that a refusal puts the cursor in it.
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

/** A token the client can read a far-off expiry from, so nothing tries to refresh it. */
const FAKE_JWT = `e30.${btoa(JSON.stringify({ sub: 'u-new', exp: 4102444800 }))}.sig`;

const NEW_MASTER = {
  id: 'u-new', email: 'ivan@ukr.net', trades: [], customTrades: [], logoUrl: null, plan: 'FREE', role: 'USER',
  emailVerified: false, createdAt: '2026-11-07T00:00:00Z', consentedToPrivacyAt: '2026-11-07T00:00:00Z',
  acknowledgedClientDataAt: null, planExpiresAt: null, autoRenew: false, cardMask: null, trialStartedAt: null,
  referralCode: 'abc12345', legalName: null, taxId: null, legalAddress: null, iban: null, bankName: null,
  vatPayer: false, vatId: null, taxGroup: null, taxRate: null, docCity: null, actNumberFormat: 'PLAIN',
};

test('двері просять три речі: чого бракує — сказано біля кнопки', async ({ page }) => {
  const sent = await answerRegistration(page, () => TAKEN);
  await page.goto('/register');

  for (const id of ['#fullName', '#phone', '#companyName']) {
    await expect(page.locator(id)).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Створити акаунт' }).click();

  const missing = page.getByText('Заповніть: Email, Пароль, згоду з політикою конфіденційності');
  await expect(missing).toBeVisible();
  await expect(missing).toBeInViewport();
  expect(sent).toEqual([]);
});

test('після реєстрації — «Чим займаєтесь?»: вибраний напрям іде одним запитом', async ({ page }) => {
  const trades: unknown[] = [];
  const registered: unknown[] = [];
  let saved: string[] = [];
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const url = request.url();
    if (request.method() === 'POST' && url.includes('/api/auth/register')) {
      registered.push(request.postDataJSON());
      await route.fulfill({
        status: 201, headers: CORS,
        json: { accessToken: FAKE_JWT, refreshToken: 'r', tokenType: 'Bearer', expiresInSeconds: 900, user: NEW_MASTER },
      });
      return;
    }
    if (request.method() === 'PUT' && url.includes('/api/profile/trades')) {
      const body = request.postDataJSON() as { trades: string[] };
      trades.push(body);
      saved = body.trades;
      await route.fulfill({ status: 200, headers: CORS, json: { ...NEW_MASTER, trades: saved } });
      return;
    }
    // A server: /me answers what was saved — the app refetches it right after «Далі».
    if (url.includes('/api/auth/me')) {
      await route.fulfill({ status: 200, headers: CORS, json: { ...NEW_MASTER, trades: saved } });
      return;
    }
    await route.fulfill({ status: 204, headers: CORS });
  });

  await page.goto('/register');
  await page.fill('#email', 'ivan@ukr.net');
  await fillAllButEmail(page);
  await page.getByRole('button', { name: 'Створити акаунт' }).click();

  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByRole('heading', { name: 'Чим займаєтесь?' })).toBeVisible();
  expect(registered).toEqual([expect.objectContaining({ email: 'ivan@ukr.net', password: 'Test1234!', consent: true })]);
  expect(registered[0]).not.toHaveProperty('fullName');

  const next = page.getByRole('button', { name: 'Далі' });
  await expect(next).toBeDisabled();
  await expect(next).toBeInViewport(); // the thumb reaches it without scrolling past eleven tiles
  await page.getByRole('button', { name: /Плитка/ }).click();
  await next.click();

  await expect.poll(() => trades).toEqual([{ trades: ['TILING'] }]);
  await expect(page).not.toHaveURL(/\/welcome$/);
});
