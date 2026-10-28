/// <reference lib="dom" />
// Short #3, the sequel to short-economy.ts: the work goes on — an act of completed work from the
// signed estimate, a receipt for the materials photographed into it, the act sent to the client and
// confirmed on the portal; then «Економіка» shows the work accepted and the materials, and «Мої
// гроші» counts the receipt as an expense.
//
// Unlike short #1 this one runs against the REAL backend: every figure on screen is the backend's
// own arithmetic, not a fixture. The seed goes through the public API — a fresh master, his client,
// an object, an estimate from the shipped catalog — and the client signs on the real portal.
//
//   SHORT_API=http://localhost:8080            the backend (dev profile; CORS must allow :5183)
//   SHORT_BACKEND_LOG=/path/to/backend.log     its log: in dev the email-confirmation link is
//                                              logged, not sent, and sharing needs a confirmed email
//   SHORT_MUSIC=… npm run short:acts           → marketing/shorts/acts/majstr-acts.mp4
//
// Recording and composition: scripts/shorts/kit.ts.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Browser } from '@playwright/test';
import { PACE, Recorder, beat, compose, launch, phoneContext, root, startVite } from './shorts/kit.ts';
import { renderReceipt } from './shorts/receipt.ts';

const outDir = path.join(root, 'marketing', 'shorts', 'acts');
/** The receipt photo: a fictional store (scripts/shorts/receipt.ts renders it). */
const RECEIPT = { label: 'Кабель, підрозетники, гофра', amount: '3485' };
const API = process.env.SHORT_API ?? 'http://localhost:8080';
const BACKEND_LOG = process.env.SHORT_BACKEND_LOG;
const PORT = 5183;
const APP = `http://localhost:${PORT}`;
const PASSWORD = 'Majstr2026';

/** The signed estimate: real positions of the shipped library, electrical trade. */
const LINES: Array<[string, number]> = [
  ['Демонтаж розетки, вимикача або світильника', 14],
  ['Штроблення під електрокабель 20х20 мм (в цеглі)', 42],
  ['Прокладка кабелю перерізом до 2,5 мм² в гофрованій трубі', 160],
  ['Монтаж підрозетника', 28],
  ['Установка та підключення розеток та вимикачів', 28],
  ['Збірка та комутація електрощита, за 1 модуль', 18],
];

interface Seeded { projectId: string; accessToken: string; refreshToken: string }

async function call<T>(method: string, url: string, body?: unknown, token?: string): Promise<T> {
  const res = await fetch(API + url, {
    method,
    headers: { 'Content-Type': 'application/json', 'Accept-Language': 'uk', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

/** The dev backend logs the confirmation link instead of mailing it; take this master's token from there. */
async function confirmEmail(email: string): Promise<void> {
  if (!BACKEND_LOG) throw new Error('SHORT_BACKEND_LOG is not set — sharing the estimate needs a confirmed email');
  for (let i = 0; i < 20; i++) {
    const line = readFileSync(BACKEND_LOG, 'utf8').split('\n').reverse().find((l) => l.includes(email) && l.includes('token='));
    const token = line ? /token=([\w-]+)/.exec(line)?.[1] : undefined;
    if (token) {
      await call('POST', '/api/auth/verify-email', { token });
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no confirmation link for ${email} in ${BACKEND_LOG}`);
}

async function seed(): Promise<Seeded> {
  const email = `short${Date.now()}@majstr.pro`;
  const auth = await call<{ accessToken: string; refreshToken: string }>('POST', '/api/auth/register', {
    email, password: PASSWORD, fullName: 'Олександр Коваль', trades: ['ELECTRICAL'], phone: '+380971234567',
    companyName: 'Олександр Коваль', consent: true,
  });
  const tk = auth.accessToken;
  await confirmEmail(email);
  const client = await call<{ id: string }>('POST', '/api/clients',
    { fullName: 'Марія Іваненко', phone: '+380675551234', address: 'вул. Зубрівська, 12, Львів' }, tk);
  const project = await call<{ id: string }>('POST', '/api/projects',
    { name: 'Квартира на Зубрівській', address: 'вул. Зубрівська, 12, Львів', clientId: client.id }, tk);
  const estimate = await call<{ id: string }>('POST', `/api/projects/${project.id}/estimates`, {}, tk);
  const catalog = await call<Array<{ id: string; name: string }>>('GET', '/api/catalog?type=WORK', undefined, tk);
  const items = LINES.map(([name, quantity]) => {
    const c = catalog.find((x) => x.name === name);
    if (!c) throw new Error(`the catalog has no «${name}»`);
    return { catalogItemId: c.id, quantity, trade: 'ELECTRICAL' };
  });
  await call('POST', `/api/estimates/${estimate.id}/items/batch`, { items }, tk);
  // The client signs on the real portal, exactly as the first short ends.
  const portal = await call<{ url: string }>('PUT', `/api/projects/${project.id}/portal`, { estimateIds: [estimate.id] }, tk);
  const token = new URL(portal.url).searchParams.get('p');
  const view = await call<{ estimates: Array<{ version: number }> }>('GET', `/api/public/portal/${token}`);
  await call('POST', `/api/public/portal/${token}/estimates/${estimate.id}/sign`,
    { clientName: 'Марія Іваненко', clientPhone: '', version: view.estimates[0].version });
  // The advance from the previous short: a 50/50 schedule, the first half received.
  const plan = await call<Array<{ id: string; amount: number }>>('POST', `/api/projects/${project.id}/payments/split/commit`, { preset: 'FIFTY_FIFTY' }, tk);
  await call('POST', `/api/projects/${project.id}/payments/receipts`,
    { planPaymentId: plan[0].id, amount: plan[0].amount, receivedAt: new Date().toISOString().slice(0, 10) }, tk);
  // Registration's own tokens: a separate login per run would soon meet the login rate limit.
  const fresh = await call<{ accessToken: string; refreshToken: string }>('POST', '/api/auth/refresh', { refreshToken: auth.refreshToken });
  return { projectId: project.id, accessToken: fresh.accessToken, refreshToken: fresh.refreshToken };
}

async function record(browser: Browser, rec: Recorder, s: Seeded): Promise<void> {
  const context = await phoneContext(browser, /^https?:\/\/localhost[:/]/);
  await context.addInitScript(([a, r]) => {
    localStorage.setItem('majstr.accessToken', a);
    localStorage.setItem('majstr.refreshToken', r);
  }, [s.accessToken, s.refreshToken]);

  // Warm Vite up first, unrecorded: a cold compile is half a minute of white screen.
  const warm = await context.newPage();
  warm.setDefaultTimeout(120_000);
  await warm.goto(`${APP}/projects/${s.projectId}?tab=acts`);
  await warm.getByRole('button', { name: '+ Новий акт' }).waitFor().catch(async (e: unknown) => {
    await warm.screenshot({ path: path.join(outDir, 'warm-failed.png') });
    console.log('  warm-up stuck at', warm.url());
    throw e;
  });
  await warm.close();

  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.goto(`${APP}/projects/${s.projectId}?tab=acts`);
  await page.getByRole('button', { name: '+ Новий акт' }).waitFor();
  rec.start(page);
  await rec.step(page, 'Робота йде — складаю акт');
  await beat(page, 1300);
  // The «＋» is the tab's one create action.
  await page.getByRole('button', { name: '+ Новий акт' }).click();
  await page.getByText('Кошторис від', { exact: false }).first().waitFor();
  await beat(page, 900);

  await rec.step(page, 'Відмічаю, що вже зроблено');
  for (const group of ['Підготовка', 'Штроблення']) {
    const box = page.getByText(group, { exact: true }).last();
    await box.scrollIntoViewIfNeeded();
    await beat(page, 500);
    await box.click();
    await beat(page, 900);
  }
  await page.getByRole('button', { name: /Зберегти/ }).click();
  await page.waitForURL(/\/acts\/[0-9a-f-]{36}/);
  await beat(page, 1200);

  await rec.step(page, 'Чек на матеріали — просто фото');
  const gallery = page.getByRole('button', { name: /Вибрати з галереї/ });
  await gallery.scrollIntoViewIfNeeded();
  await beat(page, 700);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), gallery.click()]);
  await chooser.setFiles(path.join(outDir, 'receipt.jpg'));
  await beat(page, 1200);
  // No recognition in a demo run: the photo is saved first, the sum typed — the app's own slow-link path.
  await page.getByText('Прочитати суми автоматично').click();
  await beat(page, 600);
  await page.getByRole('button', { name: /Додати чеки/ }).click();
  await beat(page, 2500);
  await rec.snap(page, 'receipt-added');
  await page.getByRole('button', { name: 'Редагувати', exact: true }).first().click();
  await beat(page, 1200);
  const sheet = page.getByRole('dialog').last();
  // The server's «Чек №N» is the field's placeholder: typing replaces it.
  const receiptName = sheet.getByPlaceholder(/^Чек №\d+$/);
  await receiptName.click();
  await receiptName.pressSequentially(RECEIPT.label, { delay: 35 * PACE });
  await sheet.locator('input[inputmode="decimal"]').first().click();
  await sheet.locator('input[inputmode="decimal"]').first().pressSequentially(RECEIPT.amount, { delay: 90 * PACE });
  await beat(page, 600);
  await rec.snap(page, 'receipt-filled');
  await sheet.getByRole('button', { name: 'Зберегти' }).click();
  await beat(page, 1500);
  await rec.snap(page, 'receipt-saved');

  await rec.step(page, 'Аванс зараховую — одним тапом');
  const offset = page.getByRole('button', { name: /Зарахувати .* у цей акт/ });
  await offset.scrollIntoViewIfNeeded();
  await beat(page, 700);
  await offset.click();
  await beat(page, 1500);
  await rec.snap(page, 'offset');
  await page.getByRole('button', { name: /^Зберегти/ }).last().click();
  await beat(page, 1500);

  await rec.step(page, 'Надіслав акт клієнту');
  await page.getByRole('button', { name: 'Поділитися з клієнтом' }).first().click();
  await beat(page, 1500);
  await rec.snap(page, 'share');
  await page.getByRole('button', { name: /Копіювати посилання/ }).click().catch(() => undefined);
  await beat(page, 1300);
  const actId = /\/acts\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  const share = await call<{ url: string | null }>('GET', `/api/acts/${actId}/share`, undefined, s.accessToken);
  if (!share.url) throw new Error('the act has no share link');

  await page.goto(share.url);
  const name = page.locator('#actSignName');
  await name.waitFor();
  await rec.step(page, 'Клієнт бачить роботи й чеки');
  await beat(page, 900);
  await page.mouse.wheel(0, 450);
  await beat(page, 1500);
  await rec.snap(page, 'portal-act');
  await name.scrollIntoViewIfNeeded();
  await beat(page, 600);
  await rec.step(page, 'Клієнт підтвердив приймання ✓');
  await name.click();
  await name.pressSequentially('Марія Іваненко', { delay: 35 * PACE });
  await beat(page, 500);
  await page.locator('#actSignBtn').click();
  await page.getByText('Приймання робіт підтверджено').first().waitFor();
  await beat(page, 1800);
  await rec.snap(page, 'act-signed');

  await page.goto(`${APP}/projects/${s.projectId}?tab=economy`);
  await page.getByText('За договором').first().waitFor();
  await rec.step(page, 'Економіка: прийнято актом і матеріали');
  await beat(page, 1800);
  await page.mouse.wheel(0, 500);
  await beat(page, 1800);
  await rec.snap(page, 'economy');

  await page.goto(`${APP}/finance`);
  await page.getByText('Прийшло').first().waitFor();
  await rec.step(page, 'Мої гроші: чек уже у витратах');
  await beat(page, 2600);
  await rec.still(page);
  await rec.stop();
  await context.close();
}

async function main(): Promise<void> {
  try {
    await fetch(`${API}/api/auth/me`);
  } catch {
    throw new Error(`the backend is not reachable at ${API} — start it (dev profile) first`);
  }
  const s = await seed();
  const rec = new Recorder(outDir);
  await renderReceipt(path.join(outDir, 'receipt.jpg'));
  const vite = await startVite(PORT, API);
  const browser = await launch();
  try {
    await record(browser, rec, s);
    await compose(browser, rec, {
      title: 'Акт і чеки — з телефона',
      hook: { lines: ['Клієнт підтвердив акт —', 'і чеки вже в рахунку'], chip: 'Показую як ↓', badge: '✓ Прийнято' },
      outroLine: 'Кошторис, акти й чеки — в одному телефоні',
      file: 'majstr-acts.mp4',
    });
  } finally {
    await browser.close();
    vite.kill();
  }
}

await main();
