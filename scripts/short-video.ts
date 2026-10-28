/// <reference lib="dom" />
// Short #1: from the landing page through registration, a new object, works from the catalog,
// quantities and a price edited in the row, the link to the client — to the client's signature on
// the portal. Recorded from the real interface against an in-memory demo backend below (no real
// backend, no real data); the portal is the backend's own page, read from the sibling repo.
// Recording and composition: scripts/shorts/kit.ts.
//
//   SHORT_MUSIC=path/to/music.m4a npm run short:video   → marketing/shorts/estimate/majstr-short.mp4
//
// A request the demo backend does not know is LOGGED and answered 404.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Browser, BrowserContext, Route } from '@playwright/test';
import { Recorder, beat, compose, launch, phoneContext, root, startVite, typeSlow } from './shorts/kit.ts';

const outDir = path.join(root, 'marketing', 'shorts', 'estimate');
const backendDir = path.resolve(root, process.env.MAJSTR_BACKEND_DIR ?? '../majstr-backend');
const PORT = 5182;
const APP = `http://localhost:${PORT}`;
const API = 'http://api.majstr.test';
const PORTAL = 'http://portal.majstr.test';
const NOW = new Date('2026-10-27T10:00:00+02:00');

// ---- the demo backend: one master, the object he creates, the estimate he builds ----------------

const ISO = NOW.toISOString();

const user = {
  id: 'u-demo', email: 'oleksandr@majstr.pro', fullName: 'Олександр Коваль', trades: ['ELECTRICAL'],
  customTrades: [], phone: '+380 97 123 45 67', companyName: 'Олександр Коваль', logoUrl: null,
  plan: 'FREE', role: 'USER', emailVerified: true, createdAt: ISO,
  consentedToPrivacyAt: ISO, acknowledgedClientDataAt: ISO,
  planExpiresAt: null, autoRenew: false, cardMask: null, trialStartedAt: null, referralCode: 'demo01',
  legalName: null, taxId: null, legalAddress: null, iban: null, bankName: null, vatPayer: false,
  vatId: null, taxGroup: null, taxRate: null, docCity: 'Львів', actNumberFormat: 'PLAIN',
};

interface Json { [k: string]: unknown }

interface Line {
  id: string; name: string; category: string; unit: string; quantity: number; unitPrice: number;
}

/** The catalog he picks from — real positions and prices of the shipped library, electrical trade. */
const CATALOG = [
  ['Демонтаж розетки, вимикача або світильника', 'Підготовка', 'PIECE', 80],
  ['Демонтаж старої електропроводки', 'Підготовка', 'LINEAR_METER', 50],
  ['Штроблення під електрокабель 20х20 мм (в цеглі)', 'Штроблення', 'LINEAR_METER', 130],
  ['Прокладка кабелю перерізом до 2,5 мм² в гофрованій трубі', 'Кабель', 'LINEAR_METER', 65],
  ['Монтаж підрозетника', 'Підрозетники', 'PIECE', 60],
  ['Установка та підключення розеток та вимикачів', 'Розетки', 'PIECE', 140],
  ['Установка та підключення точкового світильника софіта', 'Освітлення', 'PIECE', 250],
  ['Збірка та комутація електрощита, за 1 модуль', 'Щит', 'PIECE', 200],
].map(([name, category, unit, price], i) => ({
  id: `cat-${i + 1}`, name, category, trade: 'ELECTRICAL', customTradeId: null, customTradeName: null,
  type: 'WORK', unit, defaultPrice: price, description: null, sortOrder: i, pinned: false,
}));

/** What he ticks, then types in the rows — and the one price he changes. */
const PICKS = [
  'Демонтаж розетки, вимикача або світильника',
  'Штроблення під електрокабель 20х20 мм (в цеглі)',
  'Прокладка кабелю перерізом до 2,5 мм² в гофрованій трубі',
  'Установка та підключення розеток та вимикачів',
];
const QUANTITIES: Array<[string, string]> = [
  [PICKS[0], '8'], [PICKS[1], '24'], [PICKS[2], '60'], [PICKS[3], '12'],
];
const PRICE_EDIT: [string, string] = [PICKS[3], '160'];

const PROJECT_ID = 'p-1';
const ESTIMATE_ID = 'e-1';
const TOKEN = 'k7Qm2xVn';

const state = {
  project: null as Json | null,
  lines: [] as Line[],
  hasEstimate: false,
  status: 'DRAFT' as 'DRAFT' | 'SENT' | 'SIGNED',
  signature: null as Json | null,
};

const total = () => state.lines.reduce((s, l) => s + Math.round(l.quantity * l.unitPrice * 100) / 100, 0);

function projectView(): Json {
  return {
    ...state.project, latestEstimateTotal: state.hasEstimate ? total() : null,
    estimateStatus: state.hasEstimate ? state.status : null,
    stage: state.status === 'SIGNED' ? 'IN_PROGRESS' : state.status === 'SENT' ? 'PENDING_SIGNATURE' : 'ASSESSMENT',
  };
}

function itemView(l: Line, i: number): Json {
  return {
    id: l.id, type: 'WORK', name: l.name, category: l.category, trade: 'ELECTRICAL', description: null,
    unit: l.unit, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: Math.round(l.quantity * l.unitPrice * 100) / 100,
    sortOrder: i, measurementRefs: [], quantityManual: true, percentBaseKind: null, percentBaseItemId: null,
    baseDetached: false, baseOriginLabel: null, closedByActs: null, sourceUnitPrice: null,
  };
}

function estimateView(): Json {
  const t = total();
  return {
    id: ESTIMATE_ID, projectId: PROJECT_ID, name: null, status: state.status, validUntil: null, notes: null,
    qualityNote: null, createdAt: ISO, updatedAt: ISO, signedAt: state.status === 'SIGNED' ? ISO : null,
    items: state.lines.map(itemView), worksSubtotal: t, materialsSubtotal: 0, total: t,
    depositAmount: null, balance: t, sourceEstimateIds: [], crewMargin: null,
  };
}

function summaryView(): Json {
  return {
    id: ESTIMATE_ID, projectId: PROJECT_ID, name: null, status: state.status, validUntil: null,
    createdAt: ISO, updatedAt: ISO, countInEconomy: true, markupPercent: null, duplicatedFromId: null,
    supersededByEstimateId: null,
  };
}

function lineFromCatalog(catalogItemId: string, quantity: number): Line {
  const c = CATALOG.find((x) => x.id === catalogItemId);
  if (!c) throw new Error(`no catalog item ${catalogItemId}`);
  return {
    id: `it-${state.lines.length + 1}`, name: String(c.name), category: String(c.category), unit: String(c.unit),
    quantity, unitPrice: Number(c.defaultPrice),
  };
}

const portalUrl = `${PORTAL}/portal/?p=${TOKEN}`;

function portalView(): Json {
  const t = total();
  return {
    contractor: { companyName: user.companyName, phone: user.phone, logoUrl: null },
    project: { name: state.project?.name, address: state.project?.address, clientName: null },
    sharedPhotos: [], payments: null,
    estimates: [{
      id: ESTIMATE_ID, name: null, status: state.status, validUntil: null, notes: null, createdAt: ISO,
      signature: state.signature, version: 3,
      items: state.lines.map((l) => ({
        name: l.name, unit: l.unit, type: 'WORK', trade: null, category: l.category, quantity: l.quantity,
        unitPrice: l.unitPrice, lineTotal: Math.round(l.quantity * l.unitPrice * 100) / 100,
        percentBaseKind: null, baseOriginLabel: null,
      })),
      worksSubtotal: t, materialsSubtotal: 0, total: t, markupPercent: null, markupAmount: null,
      discountPercent: null, discountAmount: null,
    }],
  };
}

const portalLinks = () => ({
  url: portalUrl, paymentsVisible: false,
  estimates: [{ estimateId: ESTIMATE_ID, visible: true, status: state.status, name: null, total: total() }],
});

const unanswered = new Set<string>();

type Handler = (url: URL, body: Json | null, m: RegExpExecArray) => unknown;

const ROUTES: Array<[string, RegExp, Handler]> = [
  ['POST', /^\/api\/auth\/register$/, () => ({
    accessToken: 'demo-access', refreshToken: 'demo-refresh', tokenType: 'Bearer', expiresInSeconds: 3600, user,
  })],
  ['GET', /^\/api\/auth\/me$/, () => user],
  ['GET', /^\/api\/plan\/limits$/, () => ({
    plan: 'FREE', maxProjects: 2, projectsUsed: state.project ? 1 : 0, maxEstimatesPerProject: 3,
    maxPhotosPerObject: 10, maxReceiptPhotosPerObject: 10,
  })],
  ['GET', /^\/api\/dashboard\/metrics$/, () => ({
    activeProjects: state.project ? 1 : 0, pendingObjects: state.status === 'SENT' ? 1 : 0,
    completedThisMonth: { count: 0, totalAmount: 0 },
  })],
  ['GET', /^\/api\/cash\/summary$/, () => ({ income: 0, expense: 0, earned: 0 })],
  ['GET', /^\/api\/cash$/, (u) => ({
    from: u.searchParams.get('from'), to: u.searchParams.get('to'), income: 0, expense: 0, earned: 0,
    refunds: 0, truncated: false, months: [], entries: [],
  })],
  ['GET', /^\/api\/shopping-lists\/summary$/, () => []],
  ['GET', /^\/api\/notifications/, () => []],
  ['GET', /^\/api\/catalog\/update-notices?$/, () => []],
  ['GET', /^\/api\/catalog\/categories$/, () => [...new Set(CATALOG.map((c) => c.category))]],
  ['GET', /^\/api\/catalog$/, () => CATALOG],
  ['GET', /^\/api\/estimate-templates$/, () => []],
  ['GET', /^\/api\/clients$/, () => []],
  ['GET', /^\/api\/projects$/, () => (state.project ? [projectView()] : [])],
  ['POST', /^\/api\/projects$/, (_u, b) => {
    state.project = {
      id: PROJECT_ID, name: b?.name, address: b?.address, status: 'DRAFT', stage: 'ASSESSMENT', description: null,
      clientId: null, clientFullName: null, latestEstimateTotal: null, estimateStatus: null, unreadQuestions: 0,
      completedAt: null, createdAt: ISO, updatedAt: ISO,
    };
    return projectView();
  }],
  ['GET', /^\/api\/projects\/[^/]+$/, () => projectView()],
  ['GET', /^\/api\/projects\/[^/]+\/estimates$/, () => (state.hasEstimate ? [summaryView()] : [])],
  ['POST', /^\/api\/projects\/[^/]+\/estimates$/, () => {
    state.hasEstimate = true;
    return estimateView();
  }],
  ['GET', /^\/api\/projects\/[^/]+\/portal$/, () => portalLinks()],
  ['POST', /^\/api\/projects\/[^/]+\/portal(\/mark-sent)?$/, () => {
    state.status = 'SENT';
    return portalLinks();
  }],
  ['GET', /^\/api\/projects\/[^/]+\/shopping-list$/, () => ({
    id: null, projectId: PROJECT_ID, projectName: state.project?.name, archivedAt: null, totalCount: 0,
    boughtCount: 0, sourceEstimateUnsigned: false, items: [],
  })],
  ['GET', /^\/api\/projects\/[^/]+\/(photos|notes|measurements|payments|acts|receipts|messages)/, () => []],
  ['GET', /^\/api\/estimates\/[^/]+$/, () => estimateView()],
  ['GET', /^\/api\/estimates\/[^/]+\/materials\/availability$/, () => ({ available: false })],
  ['POST', /^\/api\/estimates\/[^/]+\/items\/batch$/, (_u, b) => {
    for (const e of (b?.items as Array<{ catalogItemId: string; quantity: number }>)) {
      state.lines.push(lineFromCatalog(e.catalogItemId, e.quantity));
    }
    return estimateView();
  }],
  ['POST', /^\/api\/estimates\/[^/]+\/items\/from-catalog\/([^/]+)$/, (_u, b, m) => {
    const l = lineFromCatalog(m[1], Number(b?.quantity ?? 1));
    state.lines.push(l);
    return itemView(l, state.lines.length - 1);
  }],
  ['PUT', /^\/api\/estimates\/[^/]+\/items\/([^/]+)$/, (_u, b, m) => {
    const l = state.lines.find((x) => x.id === m[1]);
    if (!l) return {};
    Object.assign(l, { name: b?.name ?? l.name, quantity: Number(b?.quantity ?? l.quantity), unitPrice: Number(b?.unitPrice ?? l.unitPrice) });
    return itemView(l, state.lines.indexOf(l));
  }],
  ['POST', /^\/api\/estimates\/[^/]+\/share(\/mark-sent)?$/, () => {
    state.status = 'SENT';
    return { id: 'sl-1', token: TOKEN, url: portalUrl, createdAt: ISO, expiresAt: null, revoked: false };
  }],
];

async function answer(route: Route): Promise<void> {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  if (method === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: cors() });
    return;
  }
  for (const [m, re, handler] of ROUTES) {
    const hit = m === method ? re.exec(url.pathname) : null;
    if (!hit) continue;
    const raw = req.postData();
    const body = raw ? (JSON.parse(raw) as Json) : null;
    await route.fulfill({
      status: 200, headers: cors(), contentType: 'application/json', body: JSON.stringify(handler(url, body, hit) ?? {}),
    });
    return;
  }
  unanswered.add(`${method} ${url.pathname}${url.search}`);
  await route.fulfill({ status: 404, headers: cors(), contentType: 'application/json', body: '{}' });
}

function cors(): Record<string, string> {
  return {
    'access-control-allow-origin': APP,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };
}

// ---- recording -----------------------------------------------------------------------------------

async function newContext(browser: Browser): Promise<BrowserContext> {
  const context = await phoneContext(browser, /^https?:\/\/(localhost|api\.majstr\.test|portal\.majstr\.test)[:/]/);
  await context.route(`${API}/**`, answer);
  const portalHtml = readFileSync(
    path.join(backendDir, 'src', 'main', 'resources', 'static', 'portal', 'index.html'), 'utf8',
  );
  await context.route(`${PORTAL}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === `/api/public/portal/${TOKEN}/estimates/${ESTIMATE_ID}/sign` && req.method() === 'POST') {
      const body = JSON.parse(req.postData() ?? '{}') as { clientName?: string };
      state.status = 'SIGNED';
      state.signature = { signerName: body.clientName ?? null, signedAt: ISO };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(portalView()) });
    } else if (url.pathname.startsWith(`/api/public/portal/${TOKEN}`)) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(portalView()) });
    } else if (url.pathname.startsWith('/portal')) {
      await route.fulfill({ status: 200, contentType: 'text/html', body: portalHtml });
    } else {
      unanswered.add(`PORTAL ${req.method()} ${url.pathname}`);
      await route.fulfill({ status: 404, body: '' });
    }
  });
  return context;
}

async function record(browser: Browser, rec: Recorder): Promise<void> {
  // Warm Vite up first, unrecorded: a cold compile is half a minute of white screen.
  const warm = await newContext(browser);
  const wp = await warm.newPage();
  wp.setDefaultTimeout(120_000);
  await wp.goto(APP);
  await wp.getByRole('link', { name: /Спробувати безкоштовно/ }).first().waitFor();
  await wp.goto(`${APP}/register`);
  await wp.locator('#email').waitFor();
  await warm.close();

  const context = await newContext(browser);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.clock.setFixedTime(NOW);
  rec.start(page);

  await page.goto(APP);
  await page.getByRole('link', { name: /Спробувати безкоштовно/ }).first().waitFor();
  await rec.step(page, 'Відкрив majstr.pro');
  await beat(page, 1200);
  await page.mouse.wheel(0, 500);
  await beat(page, 900);
  await page.getByRole('link', { name: /Спробувати безкоштовно/ }).first().click();

  await page.locator('#email').waitFor();
  await rec.step(page, 'Реєстрація — без картки');
  await typeSlow(page, '#email', user.email);
  await typeSlow(page, '#password', 'Majstr2026');
  await typeSlow(page, '#fullName', user.fullName);
  await page.getByText('Електрика', { exact: true }).click();
  await page.locator('#phone').scrollIntoViewIfNeeded();
  await typeSlow(page, '#phone', '+380971234567');
  // «Назва компанії» arrives filled from the name — exactly what he wants, so it is left alone.
  await page.locator('input[name="consent"]').check();
  await rec.snap(page, 'register-filled');
  await beat(page, 500);
  await page.getByRole('button', { name: 'Створити акаунт' }).click();
  await page.waitForURL(`${APP}/`);
  await rec.step(page, 'Створив обʼєкт');
  await beat(page, 1300);
  await page.getByRole('button', { name: "Новий об'єкт" }).first().click();
  await page.locator('#pr-name').waitFor();
  await typeSlow(page, '#pr-name', 'Квартира на Зубрівській');
  await typeSlow(page, '#pr-addr', 'вул. Зубрівська, 12, Львів');
  await beat(page, 400);
  await page.getByRole('button', { name: 'Створити обʼєкт' }).click();
  await page.getByText('Обʼєкт створено. Що далі?').waitFor();
  await beat(page, 900);
  await rec.snap(page, 'next-sheet');
  await page.getByRole('button', { name: 'Порожній кошторис' }).click();
  await page.waitForURL(/\/estimates\//);
  await beat(page, 900);
  await page.getByRole('button', { name: '+ Додати позицію' }).first().click();
  await page.getByPlaceholder('Пошук у каталозі...').waitFor();
  await rec.step(page, 'Роботи — з каталогу з цінами');
  await beat(page, 600);
  for (const name of PICKS) {
    const tick = page.getByTestId('catalog-row').filter({ hasText: name }).first();
    await tick.scrollIntoViewIfNeeded();
    await tick.click();
    await beat(page, 450);
  }
  await rec.snap(page, 'picked');
  await page.getByRole('button', { name: /^Додати \d/ }).click();
  await page.getByRole('button', { name: `Кількість, ${PICKS[0]}` }).waitFor();
  await beat(page, 900);

  await rec.step(page, 'Правлю прямо в рядку — як в Excel');
  for (const [name, qty] of QUANTITIES) {
    const cell = page.getByRole('button', { name: `Кількість, ${name}` });
    await cell.scrollIntoViewIfNeeded();
    await cell.click();
    await page.keyboard.type(qty, { delay: 90 });
    await beat(page, 250);
    // Enter saves and opens the next cell («Далі ↓»); Esc leaves that one untouched.
    await page.keyboard.press('Enter');
    await beat(page, 150);
    await page.keyboard.press('Escape');
    await beat(page, 450);
  }
  const price = page.getByRole('button', { name: `Ціна, ${PRICE_EDIT[0]}` });
  await price.scrollIntoViewIfNeeded();
  await price.click();
  await page.keyboard.type(PRICE_EDIT[1], { delay: 110 });
  await beat(page, 400);
  await page.keyboard.press('Enter');
  await beat(page, 150);
  await page.keyboard.press('Escape');
  await beat(page, 1200);
  await rec.snap(page, 'edited');

  const send = page.getByRole('button', { name: /Надіслати клієнту/ }).first();
  await send.scrollIntoViewIfNeeded();
  await beat(page, 500);
  await rec.step(page, 'Надіслав клієнту посилання');
  await send.click();
  await page.getByRole('button', { name: /Копіювати посилання/ }).waitFor();
  await beat(page, 900);
  await page.getByRole('button', { name: /Копіювати посилання/ }).click().catch(() => undefined);
  await beat(page, 1200);
  await rec.snap(page, 'shared');

  await page.goto(portalUrl);
  const sign = page.getByRole('button', { name: 'Підписати' }).first();
  await sign.waitFor();
  await rec.step(page, 'Клієнт бачить кожну позицію');
  await beat(page, 700);
  await page.mouse.wheel(0, 350);
  await beat(page, 1200);
  await sign.scrollIntoViewIfNeeded();
  await beat(page, 500);
  await sign.click();
  await page.locator('#signName').waitFor();
  await rec.step(page, 'Клієнт підписав ✓');
  await typeSlow(page, '#signName', 'Марія Іваненко');
  await beat(page, 400);
  await page.locator('#signSubmit').click();
  await page.getByText('Кошторис підписано').first().waitFor();
  await beat(page, 2200);
  await page.evaluate(() => window.scrollTo(0, 0));
  await beat(page, 300);
  await rec.still(page);
  await rec.snap(page, 'signed');
  await page.waitForTimeout(500);
  await rec.stop();
  await context.close();
}

async function main(): Promise<void> {
  const rec = new Recorder(outDir);
  const vite = await startVite(PORT, API);
  const browser = await launch();
  try {
    await record(browser, rec);
    await compose(browser, rec, {
      title: 'Від сайту до підпису клієнта',
      hook: { lines: ['Клієнт підписав кошторис —', 'не виходячи з дому'], chip: 'Показую весь шлях ↓', badge: '✓ Підписано' },
      outroLine: 'Кошторис з телефона — для майстрів і бригад',
      file: 'majstr-short.mp4',
    });
  } finally {
    await browser.close();
    vite.kill();
    if (unanswered.size > 0) {
      console.log('\nRequests the demo backend did not answer (404):');
      for (const r of unanswered) console.log(`  ${r}`);
    }
  }
}

await main();
