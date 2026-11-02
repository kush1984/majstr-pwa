import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Would the policy in public/_headers break the app if it were enforced? Cloudflare applies that file and
 * `vite preview` does not, so here the production build is served under it, ENFORCED, and any violation
 * fails. Needs no backend. Local builds talk to localhost:8080, which stands in for the API origin.
 */

test.use({ serviceWorkers: 'block' });

const headers = readFileSync(resolve(process.cwd(), 'public/_headers'), 'utf-8');
const policy = (/Content-Security-Policy(?:-Report-Only)?: (.+)/.exec(headers)?.[1] ?? '')
  .replace(/https:\/\/api\.majstr\.pro/g, 'http://localhost:8080')
  .replace(/;\s*report-uri [^;]+/, '');

for (const path of ['/', '/login', '/register', '/privacy']) {
  test(`${path} works under the enforced policy`, async ({ page }) => {
    expect(policy).toContain('default-src');
    const violations: string[] = [];
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        (window as unknown as { __csp: string[] }).__csp ??= [];
        (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
      });
    });
    page.on('console', (message) => {
      if (message.text().includes('Content Security Policy')) violations.push(message.text());
    });
    await page.route('**/*', async (route) => {
      if (route.request().resourceType() !== 'document') {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), 'content-security-policy': policy },
      });
    });

    await page.goto(path);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#root')).not.toBeEmpty();
    const recorded = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
    expect([...violations, ...recorded]).toEqual([]);
  });
}
