/// <reference lib="dom" />
// A vertical short (1080 × 1920) of the real app: from the landing page through registration, a
// new object, works from the catalog, prices edited in the row, the link to the client — to the
// client's signature on the portal. Recorded by Playwright from the real interface, the way
// scripts/landing-shots.ts shoots its screens: its own Vite dev server, and EVERY API call answered
// by an in-memory demo backend below — no real backend, no real data.
//
//   SHORT_MUSIC=path/to/music.m4a npm run short:video   → marketing/shorts/majstr-short.mp4
//
// Then ffmpeg (on PATH) speeds the recording up, puts each step's caption above the phone, adds the
// intro and outro cards and the music. marketing/ is generated, not versioned.
//
// SHORT_SHOTS=1 also drops a PNG at every step into marketing/shorts/debug/, to see what the
// recording is looking at. A request the demo backend does not know is LOGGED and answered 404.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page, type Route } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'marketing', 'shorts');
const debugDir = path.join(outDir, 'debug');
const backendDir = path.resolve(root, process.env.MAJSTR_BACKEND_DIR ?? '../majstr-backend');
const SHOTS = process.env.SHORT_SHOTS === '1';
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

/** The catalog he picks from — real positions of the shipped library, electrical trade. */
const CATALOG = [
  ['Демонтаж розетки, вимикача або світильника', 'Демонтаж', 'PIECE', 80],
  ['Демонтаж старої електропроводки', 'Демонтаж', 'LINEAR_METER', 50],
  ['Штроблення стін під кабель (цегла)', 'Прокладання кабелю', 'LINEAR_METER', 120],
  ['Прокладання кабелю в штробі', 'Прокладання кабелю', 'LINEAR_METER', 45],
  ['Монтаж підрозетника в цеглу', 'Розетки й вимикачі', 'PIECE', 90],
  ['Встановлення розетки', 'Розетки й вимикачі', 'PIECE', 150],
  ['Встановлення вимикача', 'Розетки й вимикачі', 'PIECE', 150],
  ['Монтаж світильника на стелю', 'Освітлення', 'PIECE', 350],
  ['Збирання електрощита до 12 модулів', 'Щитове обладнання', 'PIECE', 2500],
].map(([name, category, unit, price], i) => ({
  id: `cat-${i + 1}`, name, category, trade: 'ELECTRICAL', customTradeId: null, customTradeName: null,
  type: 'WORK', unit, defaultPrice: price, description: null, sortOrder: i, pinned: false,
}));

/** What he ticks, then types in the rows — and the one price he changes. */
const PICKS = [
  'Демонтаж розетки, вимикача або світильника',
  'Штроблення стін під кабель (цегла)',
  'Прокладання кабелю в штробі',
  'Встановлення розетки',
];
const QUANTITIES: Array<[string, string]> = [
  [PICKS[0], '8'], [PICKS[1], '24'], [PICKS[2], '60'], [PICKS[3], '12'],
];
const PRICE_EDIT: [string, string] = [PICKS[3], '180'];

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

/** When each caption starts, in seconds of the raw recording. */
const steps: Array<{ label: string; at: number }> = [];
let t0 = 0;
let shot = 0;

async function step(page: Page, label: string): Promise<void> {
  steps.push({ label, at: (Date.now() - t0) / 1000 });
  console.log(`  ▸ ${label}`);
  if (SHOTS) await snap(page, label);
}

async function snap(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.screenshot({ path: path.join(debugDir, `${String(++shot).padStart(2, '0')}-${name.replace(/[^\p{L}\d]+/gu, '_')}.png`) });
}

/** A human pace: the viewer has to see the tap land before the screen moves on. */
const beat = (page: Page, ms = 700) => page.waitForTimeout(ms);

async function typeSlow(page: Page, selector: string, text: string): Promise<void> {
  await page.locator(selector).click();
  await page.locator(selector).pressSequentially(text, { delay: 35 });
}

async function startVite(): Promise<ChildProcess> {
  const vite = spawn(`npx vite --port ${PORT} --strictPort`, {
    cwd: root, env: { ...process.env, VITE_API_BASE_URL: API }, shell: true, stdio: 'ignore',
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

async function newContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'uk-UA',
    timezoneId: 'Europe/Kyiv',
    serviceWorkers: 'block',
  });
  // Nothing leaves the machine: fonts fall back to the system face, analytics never loads.
  await context.route(/^https?:\/\/(?!localhost|api\.majstr\.test|portal\.majstr\.test)/, (r) => r.abort());
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

/**
 * The recording is a run of full-resolution screenshots (780 × 1688), taken back to back while the
 * scenario plays — Playwright's video recorder writes a 2× page into the top-left quarter of a grey
 * frame instead of scaling it, and Chrome's screencast hands over CSS-pixel frames (390 wide). Each
 * shot is stamped with its time and held until the next, so the clip runs in real time.
 */
function startRecording(page: Page): () => Promise<void> {
  const dir = path.join(outDir, 'raw');
  mkdirSync(dir, { recursive: true });
  const frames: Array<{ file: string; t: number }> = [];
  let running = true;
  const loop = (async () => {
    while (running) {
      const t = Date.now() / 1000;
      try {
        const jpg = await page.screenshot({ type: 'jpeg', quality: 90, caret: 'initial', timeout: 2000 });
        const file = path.join(dir, `f${String(frames.length).padStart(5, '0')}.jpg`);
        writeFileSync(file, jpg);
        frames.push({ file, t });
      } catch {
        // mid-navigation: no frame this time, the last one holds
      }
    }
  })();
  return async () => {
    running = false;
    await loop;
    const end = Date.now() / 1000;
    // The concat list starts at t0, so a step's time is a time in the clip.
    const lines: string[] = [];
    frames.forEach((fr, i) => {
      const from = i === 0 ? t0 / 1000 : fr.t;
      const to = i + 1 < frames.length ? frames[i + 1].t : end;
      lines.push(`file '${fr.file}'`, `duration ${Math.max(0.001, to - from).toFixed(4)}`);
    });
    lines.push(`file '${frames[frames.length - 1].file}'`);
    writeFileSync(path.join(dir, 'frames.txt'), lines.join('\n'));
    ffmpeg(['-f', 'concat', '-safe', '0', '-i', path.join(dir, 'frames.txt'), '-vf', 'scale=780:1688,fps=30,format=yuv420p',
      '-c:v', 'libx264', '-crf', '14', '-preset', 'fast', path.join(dir, 'raw.mp4')]);
    const span = frames.length > 1 ? frames[frames.length - 1].t - frames[0].t : 1;
    console.log(`  recorded ${frames.length} frames, ${(frames.length / span).toFixed(1)} fps`);
  };
}

async function record(browser: Browser): Promise<void> {
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
  const stopRecording = startRecording(page);
  t0 = Date.now();

  await page.goto(APP);
  await page.getByRole('link', { name: /Спробувати безкоштовно/ }).first().waitFor();
  await step(page, 'Відкрив majstr.pro');
  await beat(page, 1200);
  await page.mouse.wheel(0, 500);
  await beat(page, 900);
  await page.getByRole('link', { name: /Спробувати безкоштовно/ }).first().click();

  await page.locator('#email').waitFor();
  await step(page, 'Реєстрація — без картки');
  await typeSlow(page, '#email', user.email);
  await typeSlow(page, '#password', 'Majstr2026');
  await typeSlow(page, '#fullName', user.fullName);
  await page.getByText('Електрика', { exact: true }).click();
  await page.locator('#phone').scrollIntoViewIfNeeded();
  await typeSlow(page, '#phone', '+380971234567');
  // «Назва компанії» arrives filled from the name — exactly what he wants, so it is left alone.
  await page.locator('input[name="consent"]').check();
  await snap(page, 'register-filled');
  await beat(page, 500);
  await page.getByRole('button', { name: 'Створити акаунт' }).click();
  await page.waitForURL(`${APP}/`);
  await step(page, 'Створив обʼєкт');
  await beat(page, 1300);
  await page.getByRole('button', { name: "Новий об'єкт" }).first().click();
  await page.locator('#pr-name').waitFor();
  await typeSlow(page, '#pr-name', 'Квартира на Зубрівській');
  await typeSlow(page, '#pr-addr', 'вул. Зубрівська, 12, Львів');
  await beat(page, 400);
  await page.getByRole('button', { name: 'Створити обʼєкт' }).click();
  await page.getByText('Обʼєкт створено. Що далі?').waitFor();
  await beat(page, 900);
  await snap(page, 'next-sheet');
  await page.getByRole('button', { name: 'Порожній кошторис' }).click();
  await page.waitForURL(/\/estimates\//);
  await beat(page, 900);
  await page.getByRole('button', { name: '+ Додати позицію' }).first().click();
  await page.getByPlaceholder('Пошук у каталозі...').waitFor();
  await step(page, 'Роботи — з каталогу з цінами');
  await beat(page, 600);
  for (const name of PICKS) {
    const tick = page.getByTestId('catalog-row').filter({ hasText: name }).first();
    await tick.scrollIntoViewIfNeeded();
    await tick.click();
    await beat(page, 450);
  }
  await snap(page, 'picked');
  await page.getByRole('button', { name: /^Додати \d/ }).click();
  await page.getByRole('button', { name: `Кількість, ${PICKS[0]}` }).waitFor();
  await beat(page, 900);

  await step(page, 'Правлю прямо в рядку — як в Excel');
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
  await snap(page, 'edited');

  const send = page.getByRole('button', { name: /Надіслати клієнту/ }).first();
  await send.scrollIntoViewIfNeeded();
  await beat(page, 500);
  await step(page, 'Надіслав клієнту посилання');
  await send.click();
  await page.getByRole('button', { name: /Копіювати посилання/ }).waitFor();
  await beat(page, 900);
  await page.getByRole('button', { name: /Копіювати посилання/ }).click().catch(() => undefined);
  await beat(page, 1200);
  await snap(page, 'shared');

  await page.goto(portalUrl);
  const sign = page.getByRole('button', { name: 'Підписати' }).first();
  await sign.waitFor();
  await step(page, 'Клієнт бачить кожну позицію');
  await beat(page, 700);
  await page.mouse.wheel(0, 350);
  await beat(page, 1200);
  await sign.scrollIntoViewIfNeeded();
  await beat(page, 500);
  await sign.click();
  await page.locator('#signName').waitFor();
  await step(page, 'Клієнт підписав ✓');
  await typeSlow(page, '#signName', 'Марія Іваненко');
  await beat(page, 400);
  await page.locator('#signSubmit').click();
  await page.getByText('Кошторис підписано').first().waitFor();
  await beat(page, 2200);
  // The payoff, kept as a still: the hook opens on it.
  await page.evaluate(() => window.scrollTo(0, 0));
  await beat(page, 300);
  await page.screenshot({ path: path.join(outDir, 'signed.png') });
  await snap(page, 'signed');
  await page.waitForTimeout(500);
  await stopRecording();
  await context.close();
}

// ---- composing the short -------------------------------------------------------------------------

const W = 1080;
const H = 1920;
/** Where the phone sits in the frame: the 780 × 1688 recording scaled to fit. */
const PHONE = { x: 220, y: 440, w: 640, h: 1385, r: 46 };
const PAPER = '#f7f1e7';
const INK = '#2b1d14';
const AMBER = '#f26b1f';
const FONT = "Inter, 'Segoe UI', Roboto, Arial, sans-serif";

const HOOK_SECONDS = 2.4;
const OUTRO_SECONDS = 3.2;
/** The body is sped up to land the whole short near the music's length. */
const TARGET_SECONDS = 31;

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function frameHtml(inner: string, transparent = false): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;font-family:${FONT};color:${INK}}
    body{background:${transparent ? 'transparent' : `${PAPER} linear-gradient(rgba(43,29,20,.045) 1px,transparent 1px) 0 0/48px 48px, linear-gradient(90deg,rgba(43,29,20,.045) 1px,transparent 1px) 0 0/48px 48px`}}
    .brand{position:absolute;top:58px;left:0;right:0;text-align:center;font-weight:800;font-size:34px;color:${AMBER}}
    .brand span{display:inline-grid;place-items:center;width:46px;height:46px;border-radius:12px;background:${AMBER};color:#fff;margin-right:10px;vertical-align:middle}
    .title{position:absolute;top:128px;left:40px;right:40px;text-align:center;font-weight:800;font-size:60px;line-height:1.08;letter-spacing:-.02em}
    .sub{position:absolute;top:268px;left:0;right:0;text-align:center;font-size:26px;color:#7a6652}
    .chip{position:absolute;top:330px;left:0;right:0;text-align:center}
    .chip b{display:inline-block;background:${INK};color:#fff;font-size:38px;font-weight:700;padding:16px 30px;border-radius:999px;max-width:960px}
    .foot{position:absolute;bottom:34px;left:0;right:0;text-align:center;font-size:28px;font-weight:700;color:#7a6652}
  </style></head><body>${inner}</body></html>`;
}

const header = (caption: string) => `
  <div class="brand"><span>M</span>Majstr</div>
  <div class="title">Від сайту до підпису клієнта</div>
  <div class="sub">реальний запис · прискорено</div>
  <div class="chip"><b>${esc(caption)}</b></div>`;

/** The phone's frame: a dark ring, and the corners outside it painted paper — over the recording. */
function bezelHtml(): string {
  const { x, y, w, h, r } = PHONE;
  const round = `M${x + r},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} H${x + r} A${r},${r} 0 0 1 ${x},${y + h - r} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`;
  return frameHtml(`<svg width="${W}" height="${H}" style="position:absolute;inset:0">
    <path fill-rule="evenodd" fill="${PAPER}" d="M${x - 2},${y - 2} H${x + w + 2} V${y + h + 2} H${x - 2} Z ${round}"/>
    <path d="${round}" fill="none" stroke="${INK}" stroke-width="12"/>
  </svg>`, true);
}

function hookHtml(signedPng: string): string {
  const { x, y, w, h, r } = PHONE;
  return frameHtml(`
    <div class="brand"><span>M</span>Majstr</div>
    <div class="title" style="font-size:66px;top:120px">Клієнт підписав кошторис —<br><span style="color:${AMBER}">не виходячи з дому</span></div>
    <div class="chip" style="top:340px"><b>Показую весь шлях ↓</b></div>
    <img src="${signedPng}" style="position:absolute;left:${x}px;top:${y + 10}px;width:${w}px;height:${h}px;object-fit:cover;object-position:top;border-radius:${r}px;outline:12px solid ${INK}">
    <div style="position:absolute;left:${x + w - 210}px;top:${y + 380}px;transform:rotate(-8deg);background:#1f9d55;color:#fff;font-weight:800;font-size:46px;padding:16px 30px;border-radius:18px;box-shadow:0 12px 30px rgba(0,0,0,.25)">✓ Підписано</div>
    <div class="foot">majstr.pro</div>`);
}

function outroHtml(): string {
  return frameHtml(`
    <div style="position:absolute;top:560px;left:0;right:0;text-align:center">
      <div style="display:inline-grid;place-items:center;width:200px;height:200px;border-radius:48px;background:${AMBER};color:#fff;font-size:130px;font-weight:800">M</div>
      <div style="font-size:110px;font-weight:800;margin-top:36px;letter-spacing:-.03em">Majstr</div>
      <div style="font-size:40px;color:#7a6652;margin-top:8px">Кошторис з телефона — для майстрів і бригад</div>
      <div style="display:inline-block;margin-top:70px;background:${AMBER};color:#fff;font-size:52px;font-weight:800;padding:28px 56px;border-radius:24px">Спробуй безкоштовно</div>
      <div style="font-size:64px;font-weight:800;margin-top:50px">majstr.pro</div>
      <div style="font-size:34px;color:#7a6652;margin-top:14px">2 обʼєкти безкоштовно · без картки</div>
    </div>`);
}

async function renderPng(browser: Browser, html: string, file: string, transparent = false): Promise<void> {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: file, omitBackground: transparent });
  await page.close();
}

function ffmpeg(args: string[]): void {
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status})`);
}

async function compose(browser: Browser): Promise<void> {
  const rawPath = path.join(outDir, 'raw', 'raw.mp4');
  const frames = path.join(outDir, 'frames');
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });

  const signed = `data:image/png;base64,${readFileSync(path.join(outDir, 'signed.png')).toString('base64')}`;
  await renderPng(browser, hookHtml(signed), path.join(frames, 'hook.png'));
  await renderPng(browser, outroHtml(), path.join(frames, 'outro.png'));
  await renderPng(browser, bezelHtml(), path.join(frames, 'bezel.png'), true);
  for (const [i, st] of steps.entries()) {
    await renderPng(browser, frameHtml(`${header(st.label)}<div class="foot">majstr.pro</div>`), path.join(frames, `bg-${i}.png`));
  }

  const duration = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', rawPath]).stdout.toString());
  const bodyRaw = duration - steps[0].at;
  const speed = Math.max(1, bodyRaw / (TARGET_SECONDS - HOOK_SECONDS - OUTRO_SECONDS));
  console.log(`  raw ${bodyRaw.toFixed(1)} s of steps → ×${speed.toFixed(2)}`);

  // One input per step background, then the bezel, hook and outro stills.
  const inputs = ['-i', rawPath];
  steps.forEach((_, i) => inputs.push('-loop', '1', '-i', path.join(frames, `bg-${i}.png`)));
  const bezel = steps.length + 1;
  inputs.push('-loop', '1', '-i', path.join(frames, 'bezel.png'));
  inputs.push('-loop', '1', '-t', String(HOOK_SECONDS), '-i', path.join(frames, 'hook.png'));
  inputs.push('-loop', '1', '-t', String(OUTRO_SECONDS), '-i', path.join(frames, 'outro.png'));
  const hook = bezel + 1;
  const outro = bezel + 2;

  const f: string[] = [];
  f.push(`[0:v]fps=30,scale=${PHONE.w}:${PHONE.h}:flags=lanczos,split=${steps.length}${steps.map((_, i) => `[v${i}]`).join('')}`);
  f.push(`[${bezel}:v]format=rgba,split=${steps.length}${steps.map((_, i) => `[z${i}]`).join('')}`);
  steps.forEach((st, i) => {
    const end = i + 1 < steps.length ? steps[i + 1].at : duration;
    const len = (end - st.at) / speed;
    f.push(`[v${i}]trim=start=${st.at.toFixed(3)}:end=${end.toFixed(3)},setpts=(PTS-STARTPTS)/${speed.toFixed(4)}[c${i}]`);
    f.push(`[${i + 1}:v]fps=30,trim=duration=${len.toFixed(3)}[b${i}]`);
    f.push(`[b${i}][c${i}]overlay=${PHONE.x}:${PHONE.y}:shortest=1[o${i}]`);
    f.push(`[o${i}][z${i}]overlay=0:0:shortest=1,setsar=1[s${i}]`);
  });
  f.push(`[${hook}:v]fps=30,setsar=1[h]`);
  f.push(`[${outro}:v]fps=30,setsar=1[e]`);
  f.push(`[h]${steps.map((_, i) => `[s${i}]`).join('')}[e]concat=n=${steps.length + 2}:v=1:a=0,format=yuv420p[out]`);
  const silent = path.join(outDir, 'majstr-short-silent.mp4');
  ffmpeg([...inputs, '-filter_complex', f.join(';'), '-map', '[out]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-r', '30', silent]);

  const music = process.env.SHORT_MUSIC;
  const final = path.join(outDir, 'majstr-short.mp4');
  if (!music) {
    renameSync(silent, final);
    console.log('  (no SHORT_MUSIC — the short is silent)');
  } else {
    const len = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', silent]).stdout.toString());
    ffmpeg(['-i', silent, '-stream_loop', '-1', '-i', music, '-filter_complex',
      `[1:a]atrim=duration=${len.toFixed(3)},afade=t=out:st=${(len - 1.2).toFixed(3)}:d=1.2[a]`,
      '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', final]);
    rmSync(silent);
  }
  console.log(`  ✓ ${path.relative(root, final)}`);
}

async function main(): Promise<void> {
  rmSync(path.join(outDir, 'raw'), { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  if (SHOTS) {
    rmSync(debugDir, { recursive: true, force: true });
    mkdirSync(debugDir, { recursive: true });
  }
  const vite = await startVite();
  const browser = await chromium.launch(
    process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  );
  try {
    await record(browser);
    await compose(browser);
  } finally {
    await browser.close();
    vite.kill();
    if (unanswered.size > 0) {
      console.log('\nRequests the demo backend did not answer (404):');
      for (const r of unanswered) console.log(`  ${r}`);
    }
  }
  writeFileSync(path.join(outDir, 'steps.json'), JSON.stringify(steps, null, 2));
}

await main();
