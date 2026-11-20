/* global document, window -- read inside page.evaluate, which runs in the browser */
// A phone-sized look at one screen of the PWA, with the backend MOCKED — for checking a UI change
// with your own eyes before calling it done (skill: ui-check).
//
// Usage: copy this file to the scratchpad, fill in `routes` and `steps`, then
//   node <copy>.mjs <out-dir>        (from C:/Work/majstr-pwa; Vite must be running on :5173)
// It prints {overflow, errors} and writes the screenshots `steps` takes.
import { createRequire } from 'node:module';
const require = createRequire('C:/Work/majstr-pwa/package.json');
const { chromium } = require('@playwright/test');

const out = process.argv[2];
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = `${b64({ alg: 'HS256' })}.${b64({ sub: '00000000-0000-0000-0000-000000000001', exp: 4102444800 })}.x`;

// A signed-in master with every one-time prompt already answered, or a consent / onboarding sheet
// covers the screen you meant to look at.
const me = {
  id: '00000000-0000-0000-0000-000000000001', email: 'm@test.ua', fullName: 'Майстер', phone: '+380',
  companyName: null, plan: 'PRO', role: 'USER', trades: ['ELECTRICAL', 'TILING'], customTrades: [],
  emailVerified: true, onboardingCompleted: true, createdAt: '2026-01-01T00:00:00Z',
  consentedToPrivacyAt: '2026-01-01T00:00:00Z', acknowledgedClientDataAt: '2026-01-01T00:00:00Z',
};

/** Exact backend paths → JSON. Anything else answers []. Keep it EXACT: a prefix like '/api/catalog'
 *  also answers '/api/catalog/update-notices', and a catalog row then reads as a notice. */
const routes = {
  '/api/auth/me': me,
  // '/api/estimate-templates': [...],
};

/** What to open and what to photograph. */
async function steps(page) {
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/1.png` });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript((t) => {
  localStorage.setItem('majstr.accessToken', t);
  localStorage.setItem('majstr.refreshToken', 'r');
}, jwt);
// ONLY the backend origin: a bare /\/api\// also catches Vite's own /src/api/*.ts modules.
await page.route(/^http:\/\/localhost:8080\/api\//, (route) => {
  const path = new URL(route.request().url()).pathname;
  const body = path in routes ? routes[path] : [];
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
await steps(page);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
console.log(JSON.stringify({ overflow, errors }));
await browser.close();
