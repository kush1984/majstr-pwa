/// <reference lib="dom" />
// Real screens for the landing page, re-shot whenever the interface changes:
//
//   npm run landing:shots
//
// Starts its own Vite dev server, opens the app at 390 × 844 (deviceScaleFactor 3) and answers
// EVERY API call from the fixtures below via `page.route` — no backend, no real data, the same
// pixels every run. The client portal is the backend's own static page, read from the sibling
// repo (MAJSTR_BACKEND_DIR, default ../majstr-backend) and fed the same demo estimate.
//
// Output: public/landing/*.webp. Playwright only writes PNG/JPEG, so each PNG is re-encoded to
// WebP by the same Chromium through a canvas — no image dependency.
//
// A request no fixture answers is LOGGED (and answered 404), so a screen that changes what it
// loads says so here instead of silently rendering an error state into the landing.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page, type Route } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'landing');
const backendDir = path.resolve(root, process.env.MAJSTR_BACKEND_DIR ?? '../majstr-backend');
const PORT = 5181;
const APP = `http://localhost:${PORT}`;
const API = 'http://api.majstr.test';
const PORTAL = 'http://portal.majstr.test';
const NOW = new Date('2026-10-14T10:00:00+03:00');

// ---- demo data: one object, one estimate, 48 750 ₴ everywhere ----------------------------------

const PROJECT_ID = 'p-zubrivska';
const DRAFT_ID = 'e-draft';
const MARKUP_ID = 'e-markup';
const CLIENT = 'Марія Іваненко';

const LINES = [
  { name: 'Демонтажні роботи', quantity: 40, unitPrice: 250, crew: 215 },
  { name: 'Підготовка поверхонь', quantity: 50, unitPrice: 250, crew: 210 },
  { name: 'Штукатурні роботи', quantity: 60, unitPrice: 250, crew: 215 },
  { name: 'Фарбування', quantity: 75, unitPrice: 150, crew: 130 },
] as const;
const TOTAL = LINES.reduce((s, l) => s + l.quantity * l.unitPrice, 0); // 48 750

const me = {
  id: 'u-demo', email: 'oleksandr@majstr.pro', fullName: 'Олександр Коваль', trades: ['PAINTER'],
  customTrades: [], phone: '+380 97 123 45 67', companyName: 'Олександр Коваль', logoUrl: null,
  plan: 'FREE', role: 'USER', emailVerified: true, createdAt: '2026-09-01T09:00:00Z',
  consentedToPrivacyAt: '2026-09-01T09:00:00Z', acknowledgedClientDataAt: '2026-09-01T09:00:00Z',
  planExpiresAt: null, autoRenew: false, cardMask: null, trialStartedAt: null, referralCode: 'demo01',
  legalName: null, taxId: null, legalAddress: null, iban: null, bankName: null, vatPayer: false,
  vatId: null, taxGroup: null, taxRate: null, docCity: 'Львів', actNumberFormat: 'PLAIN',
};

const project = {
  id: PROJECT_ID, name: 'Квартира на Зубрівській', address: 'вул. Зубрівська, 12, Львів',
  status: 'ACTIVE', stage: 'ESTIMATE', description: null, clientId: 'c-1', clientFullName: CLIENT,
  latestEstimateTotal: TOTAL, estimateStatus: 'DRAFT', unreadQuestions: 0, completedAt: null,
  createdAt: '2026-10-10T09:00:00Z', updatedAt: '2026-10-14T07:00:00Z',
};

function items(withCrew: boolean) {
  return LINES.map((l, i) => ({
    id: `it-${i + 1}`, type: 'WORK', name: l.name, category: 'Ремонт стін', trade: 'PAINTER', description: null,
    unit: 'M2', quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.quantity * l.unitPrice,
    sortOrder: i, measurementRefs: [], quantityManual: true, percentBaseKind: null,
    percentBaseItemId: null, baseDetached: false, baseOriginLabel: null, closedByActs: null,
    sourceUnitPrice: withCrew ? l.crew : null,
  }));
}

function estimate(id: string, status: string, withCrew: boolean) {
  const crewTotal = LINES.reduce((s, l) => s + l.quantity * l.crew, 0);
  return {
    id, projectId: PROJECT_ID, name: null, status, validUntil: null, notes: null, qualityNote: null,
    createdAt: '2026-10-14T07:00:00Z', updatedAt: '2026-10-14T07:00:00Z', signedAt: null,
    items: items(withCrew), worksSubtotal: TOTAL, materialsSubtotal: 0, total: TOTAL,
    depositAmount: null, balance: TOTAL, sourceEstimateIds: [],
    crewMargin: withCrew
      ? { crewTotal, margin: TOTAL - crewTotal, marginAccepted: 0, unpricedCount: 0, unpricedTotal: 0 }
      : null,
  };
}

const summaries = [
  {
    id: DRAFT_ID, projectId: PROJECT_ID, name: null, status: 'DRAFT', validUntil: null,
    createdAt: '2026-10-14T07:00:00Z', updatedAt: '2026-10-14T07:00:00Z', countInEconomy: true,
    markupPercent: null, duplicatedFromId: null, supersededByEstimateId: null,
  },
];

const portalLink = 'https://majstr.pro/portal/?t=k7Qm2xVn';

const client = {
  id: 'c-1', fullName: CLIENT, phone: '+380 67 555 12 34', address: project.address, email: null,
  clientType: 'INDIVIDUAL', taxId: null, legalName: null, legalAddress: null, signatoryTitle: null,
  signatoryName: null, createdAt: '2026-10-10T09:00:00Z',
};

const cash = {
  from: '2026-10-12', to: '2026-10-18', income: 30000, expense: 13350, earned: 16650, refunds: 0,
  truncated: false, months: [],
  entries: [
    { id: 'c1', kind: 'OBJECT_PAYMENT', direction: 'INCOME', amount: 20000, category: null,
      note: 'Аванс', happenedOn: '2026-10-13', projectId: PROJECT_ID, projectName: project.name,
      materialRefund: false, noteLocked: false, readOnly: false },
    { id: 'c2', kind: 'OBJECT_EXPENSE', direction: 'EXPENSE', amount: 8350, category: 'MATERIALS',
      note: 'Штукатурка, ґрунт', happenedOn: '2026-10-13', projectId: PROJECT_ID,
      projectName: project.name, materialRefund: false, noteLocked: false, readOnly: false },
    { id: 'c3', kind: 'OBJECT_PAYMENT', direction: 'INCOME', amount: 10000, category: null,
      note: 'Етап 2', happenedOn: '2026-10-14', projectId: 'p-2', projectName: 'Будинок у Винниках',
      materialRefund: false, noteLocked: false, readOnly: false },
    { id: 'c4', kind: 'PERSONAL', direction: 'EXPENSE', amount: 5000, category: 'CREW',
      note: 'Помічнику за тиждень', happenedOn: '2026-10-14', projectId: null, projectName: null,
      materialRefund: false, noteLocked: false, readOnly: false },
  ],
};

/** What the backend's portal page reads off `/api/public/portal/{token}`. */
const portalView = {
  contractor: { companyName: me.companyName, phone: me.phone, logoUrl: null },
  project: { name: project.name, address: project.address, clientName: CLIENT },
  sharedPhotos: [],
  payments: null,
  estimates: [{
    id: DRAFT_ID, name: null, status: 'SENT', validUntil: null, notes: null,
    createdAt: '2026-10-14T07:00:00Z', signature: null, version: 3,
    items: LINES.map((l) => ({
      name: l.name, unit: 'M2', type: 'WORK', trade: null, category: null, quantity: l.quantity,
      unitPrice: l.unitPrice, lineTotal: l.quantity * l.unitPrice, percentBaseKind: null,
      baseOriginLabel: null,
    })),
    worksSubtotal: TOTAL, materialsSubtotal: 0, total: TOTAL, markupPercent: null,
    markupAmount: null, discountPercent: null, discountAmount: null,
  }],
};

// ---- the fixture table ---------------------------------------------------------------------------

type Fixture = (url: URL, method: string) => unknown;

let markupMode = false;

const FIXTURES: Array<[string, RegExp, Fixture]> = [
  ['GET', /^\/api\/auth\/me$/, () => me],
  ['GET', /^\/api\/plan\/limits$/, () => ({
    plan: 'FREE', maxProjects: 2, projectsUsed: 1, maxEstimatesPerProject: 3,
    maxPhotosPerObject: 10, maxReceiptPhotosPerObject: 10,
  })],
  ['GET', /^\/api\/projects$/, () => [project]],
  ['GET', /^\/api\/projects\/[^/]+$/, () => project],
  ['GET', /^\/api\/projects\/[^/]+\/estimates$/, () => summaries],
  ['GET', /^\/api\/estimates\/e-draft$/, () =>
    markupMode ? estimate(MARKUP_ID, 'DRAFT', true) : estimate(DRAFT_ID, 'DRAFT', false)],
  ['GET', /^\/api\/estimates\/e-markup$/, () => estimate(MARKUP_ID, 'DRAFT', true)],
  ['GET', /^\/api\/projects\/[^/]+\/portal$/, () => ({
    url: portalLink, paymentsVisible: false,
    estimates: [{ estimateId: DRAFT_ID, visible: true, status: 'DRAFT', name: null, total: TOTAL }],
  })],
  ['POST', /^\/api\/projects\/[^/]+\/portal$/, () => ({
    url: portalLink, paymentsVisible: false,
    estimates: [{ estimateId: DRAFT_ID, visible: true, status: 'SENT', name: null, total: TOTAL }],
  })],
  ['GET', /^\/api\/cash$/, () => cash],
  ['GET', /^\/api\/cash\/summary$/, () => ({ income: cash.income, expense: cash.expense, earned: cash.earned })],
  ['GET', /^\/api\/notifications/, () => []],
  ['GET', /^\/api\/estimates\/[^/]+\/materials\/availability$/, () => ({ available: true })],
  ['GET', /^\/api\/projects\/[^/]+\/photos$/, () => []],
  ['GET', /^\/api\/clients\/[^/]+$/, () => client],
  ['POST', /^\/api\/estimates\/[^/]+\/share$/, () => ({
    id: 'sl-1', token: 'k7Qm2xVn', url: portalLink, createdAt: '2026-10-14T07:00:00Z',
    expiresAt: null, revoked: false,
  })],
  ['GET', /^\/api\/catalog\/update-notices$/, () => []],
];

const unanswered = new Set<string>();

async function answer(route: Route): Promise<void> {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  if (method === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: cors() });
    return;
  }
  const hit = FIXTURES.find(([m, re]) => m === method && re.test(url.pathname));
  if (!hit) {
    unanswered.add(`${method} ${url.pathname}`);
    await route.fulfill({ status: 404, headers: cors(), contentType: 'application/json', body: '{}' });
    return;
  }
  await route.fulfill({
    status: 200, headers: cors(), contentType: 'application/json', body: JSON.stringify(hit[2](url, method)),
  });
}

function cors(): Record<string, string> {
  return {
    'access-control-allow-origin': APP,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };
}

// ---- running it ----------------------------------------------------------------------------------

async function startVite(): Promise<ChildProcess> {
  const vite = spawn(`npx vite --port ${PORT} --strictPort`, {
    cwd: root,
    env: { ...process.env, VITE_API_BASE_URL: API },
    shell: true,
    stdio: 'ignore',
  });
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(APP)).ok) return vite;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  vite.kill();
  throw new Error(`Vite did not start on ${APP}`);
}

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: 'uk-UA',
    timezoneId: 'Europe/Kyiv',
    serviceWorkers: 'block',
  });
  await context.addInitScript(() => {
    localStorage.setItem('majstr.accessToken', 'demo-access');
    localStorage.setItem('majstr.refreshToken', 'demo-refresh');
  });
  // Nothing leaves the machine: fonts fall back to the system face, analytics never loads.
  await context.route(/^https?:\/\/(?!localhost|api\.majstr\.test|portal\.majstr\.test)/, (r) => r.abort());
  await context.route(`${API}/**`, answer);
  const portalHtml = readFileSync(
    path.join(backendDir, 'src', 'main', 'resources', 'static', 'portal', 'index.html'),
    'utf8',
  );
  await context.route(`${PORTAL}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/public/portal/')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(portalView) });
    } else if (url.pathname.startsWith('/portal')) {
      await route.fulfill({ status: 200, contentType: 'text/html', body: portalHtml });
    } else {
      await route.fulfill({ status: 404, body: '' });
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(90_000); // the first visit waits for Vite to compile the app
  await page.clock.setFixedTime(NOW);
  return page;
}

/** PNG from Playwright → WebP by the same Chromium, through a canvas. */
async function saveWebp(page: Page, name: string): Promise<void> {
  // Let fonts, transitions and the last fetch settle; a half-faded sheet is not a screenshot.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  const png = await page.screenshot({ type: 'png' });
  const encoder = await page.context().newPage();
  const dataUrl = await encoder.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    return canvas.toDataURL('image/webp', 0.86);
  }, png.toString('base64'));
  await encoder.close();
  writeFileSync(path.join(outDir, `${name}.webp`), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`  ✓ ${name}.webp`);
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const vite = await startVite();
  const browser = await chromium.launch();
  try {
    // 1. The estimate editor: a draft, the next-step block offering «Надіслати клієнту».
    let page = await newPage(browser);
    await page.goto(`${APP}/estimates/${DRAFT_ID}`, { waitUntil: 'commit' });
    await page.getByText('Кошторис готовий?').waitFor();
    await page.getByText('Кошторис готовий?').scrollIntoViewIfNeeded();
    await saveWebp(page, 'shot-editor');

    // 2. The share sheet, link in hand.
    await page.getByRole('button', { name: /Надіслати клієнту/ }).first().click();
    await page.getByRole('button', { name: /Копіювати посилання/ }).waitFor();
    await saveWebp(page, 'shot-share');
    await page.context().close();

    // 3. The portal as the client sees it — the backend's own page.
    page = await newPage(browser);
    await page.goto(`${PORTAL}/portal/?p=demo`);
    const sign = page.getByRole('button', { name: 'Підписати' }).first();
    await sign.waitFor();
    // The lines and the button together: the button is the one thing this frame has to show.
    await sign.evaluate((el) => el.scrollIntoView({ block: 'end' }));
    await page.evaluate(() => window.scrollBy(0, 40));
    await saveWebp(page, 'shot-portal');
    await page.context().close();

    // 4. A copy with markup: what the crew gets and what is his.
    markupMode = true;
    page = await newPage(browser);
    await page.goto(`${APP}/estimates/${MARKUP_ID}`, { waitUntil: 'commit' });
    // The phone keeps «Бригаді / Твоя націнка» in the summary sheet — open it.
    await page.getByRole('button', { name: /До сплати/, expanded: false }).click();
    await page.getByTestId('crew-margin-line').last().waitFor();
    await saveWebp(page, 'shot-margin');
    await page.context().close();
    markupMode = false;

    // 5. «Мої гроші», this week.
    page = await newPage(browser);
    await page.goto(`${APP}/finance`, { waitUntil: 'commit' });
    await page.getByText('Аванс').first().waitFor();
    await saveWebp(page, 'shot-money');
    await page.context().close();
  } finally {
    await browser.close();
    vite.kill();
    if (unanswered.size > 0) {
      console.log('\nRequests no fixture answered (404):');
      for (const r of unanswered) console.log(`  ${r}`);
    }
  }
}

await main();
