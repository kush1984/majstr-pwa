/// <reference lib="dom" />
// Short #2, the sequel to short-video.ts: the client has signed — now the object's «Економіка»
// (the contract, the payment split, the advance received) and «Мої гроші», where the object's money
// is already counted and the master adds only what no object knows about.
//
// Unlike short #1 this one runs against the REAL backend: every figure on screen is the backend's
// own arithmetic, not a fixture. The seed goes through the public API — a fresh master, his client,
// an object, an estimate from the shipped catalog — and the client signs on the real portal.
//
//   SHORT_API=http://localhost:8080            the backend (dev profile; CORS must allow :5183)
//   SHORT_BACKEND_LOG=/path/to/backend.log     its log: in dev the email-confirmation link is
//                                              logged, not sent, and sharing needs a confirmed email
//   SHORT_MUSIC=… npm run short:economy        → marketing/shorts/economy/majstr-economy.mp4
//
// Recording and composition: scripts/shorts/kit.ts.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Browser } from '@playwright/test';
import { Recorder, beat, compose, launch, phoneContext, root, startVite, typeSlow } from './shorts/kit.ts';

const outDir = path.join(root, 'marketing', 'shorts', 'economy');
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

/** What he adds by hand in «Мої гроші» — money no object knows about. */
const OWN_EXPENSE = { amount: '1500', note: 'Пальне за тиждень' };

interface Seeded { email: string; projectId: string }

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
  const auth = await call<{ accessToken: string }>('POST', '/api/auth/register', {
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
  return { email, projectId: project.id };
}

async function record(browser: Browser, rec: Recorder, s: Seeded): Promise<void> {
  const login = await call<{ accessToken: string; refreshToken: string }>('POST', '/api/auth/login', { email: s.email, password: PASSWORD });
  const context = await phoneContext(browser, /^https?:\/\/localhost[:/]/);
  await context.addInitScript(([a, r]) => {
    localStorage.setItem('majstr.accessToken', a);
    localStorage.setItem('majstr.refreshToken', r);
  }, [login.accessToken, login.refreshToken]);

  // Warm Vite up first, unrecorded: a cold compile is half a minute of white screen.
  const warm = await context.newPage();
  warm.setDefaultTimeout(120_000);
  await warm.goto(`${APP}/projects/${s.projectId}`);
  await warm.getByText('Квартира на Зубрівській').first().waitFor();
  await warm.goto(`${APP}/finance`);
  await warm.getByText('Мої гроші').first().waitFor();
  await warm.close();

  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.goto(`${APP}/projects/${s.projectId}`);
  await page.getByText('Квартира на Зубрівській').first().waitFor();
  rec.start(page);
  await rec.step(page, 'Підписаний кошторис → переїхав в Економіку');
  await beat(page, 1600);

  await page.getByRole('tab', { name: 'Економіка' }).or(page.getByRole('button', { name: 'Економіка', exact: true })).first().click();
  await page.getByText('За договором').first().waitFor();
  await rec.step(page, 'Економіка: сума за договором');
  await beat(page, 1500);
  await page.getByText('Платежі', { exact: true }).scrollIntoViewIfNeeded();
  await beat(page, 900);

  await rec.step(page, 'Розбив оплату: аванс і фінал');
  await page.getByRole('button', { name: 'Розбити на частки' }).click();
  await beat(page, 900);
  await page.getByRole('button', { name: 'Попередній перегляд' }).click();
  await beat(page, 1300);
  await page.getByRole('button', { name: 'Підтвердити розбивку' }).click();
  await beat(page, 1500);
  await rec.snap(page, 'split-done');

  await rec.step(page, 'Клієнт дав аванс');
  // A stage opens its sheet; «Отримати платіж» there records the money against that stage.
  await page.getByText('Аванс', { exact: true }).first().click();
  await beat(page, 1000);
  await page.getByRole('button', { name: 'Отримати платіж' }).click();
  await beat(page, 1200);
  await rec.snap(page, 'receive-sheet');
  await page.getByRole('button', { name: 'Зберегти' }).click();
  await beat(page, 1800);
  await page.getByText('Отримано', { exact: false }).first().scrollIntoViewIfNeeded();
  await beat(page, 1500);
  await rec.snap(page, 'received');

  await page.goto(`${APP}/finance`);
  await page.getByText('Прийшло').first().waitFor();
  await rec.step(page, 'Мої гроші: аванс уже тут');
  await beat(page, 2000);

  await rec.step(page, 'Дописав те, чого обʼєкт не знає');
  await page.getByRole('button', { name: '+ Додати запис' }).click();
  await beat(page, 800);
  await page.getByRole('button', { name: 'Витратив' }).click();
  await beat(page, 500);
  const dialog = page.getByRole('dialog').last();
  await typeSlow(page, '[role="dialog"] input[inputmode="decimal"], [role="dialog"] input[type="text"] >> nth=0', OWN_EXPENSE.amount);
  await dialog.getByRole('button', { name: 'Пальне', exact: true }).click();
  await beat(page, 400);
  await typeSlow(page, '[role="dialog"] input[placeholder*="дизель"]', OWN_EXPENSE.note);
  await beat(page, 500);
  await rec.snap(page, 'expense-filled');
  await dialog.getByRole('button', { name: 'Зберегти' }).click();
  await beat(page, 1500);

  await rec.step(page, 'Заробив — порахувано саме');
  await page.evaluate(() => window.scrollTo(0, 0));
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
  console.log(`  seeded ${s.email}`);
  const rec = new Recorder(outDir);
  const vite = await startVite(PORT, API);
  const browser = await launch();
  try {
    await record(browser, rec, s);
    await compose(browser, rec, {
      title: 'Після підпису: економіка обʼєкта',
      hook: { lines: ['Скільки я реально заробив', 'на цьому обʼєкті?'], chip: 'Економіка рахує сама ↓' },
      outroLine: 'Кошторис, платежі й гроші — в одному телефоні',
      file: 'majstr-economy.mp4',
    });
  } finally {
    await browser.close();
    vite.kill();
  }
}

await main();
