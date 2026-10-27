import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * majstr.pro used to answer EVERY path with the landing (`/* /index.html 200`), so /api/, //feed/
 * and any typo were indexed as copies of it (SEO audit 2026-10). The app's routes are now LISTED in
 * `public/_redirects` and anything else is a real 404. The cost is that a new route must be listed
 * too — or a refresh, an email/push link or the monobank return lands on 404 — so this reads the
 * router and the rules as text and fails on a route nothing serves.
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const redirects = read('public/_redirects');
const rules = redirects.split('\n')
  .map((l) => l.trim())
  .filter((l) => l !== '' && !l.startsWith('#'))
  .map((l) => l.split(/\s+/)[0]);

const served = (path: string) => rules.some((r) =>
  r.endsWith('/*') ? path.startsWith(r.slice(0, -1)) : r === path);

function appPaths(): string[] {
  const routerPaths = [...read('src/routes/routes.tsx').matchAll(/path: '([^']+)'/g)].map((m) => m[1]);
  const named = [...read('src/lib/config.ts').matchAll(/^\s+\w+: '(\/[^']*)'/gm)].map((m) => m[1]);
  const built = [...read('src/lib/config.ts').matchAll(/\(\w+: string\) => `(\/[^`$?]+)/g)].map((m) => m[1]);
  return [...routerPaths, ...named, ...built]
    .map((p) => p.replace(/:[A-Za-z]+/g, 'x'))
    .filter((p) => p !== '/' && p !== '*');
}

describe('public/_redirects — the app routes are served, nothing else is', () => {
  it('has no catch-all that hands the landing to any path', () => {
    expect(rules).not.toContain('/*');
  });

  it('serves every route the router knows', () => {
    const missing = appPaths().filter((p) => !served(p));
    expect(missing, `add to public/_redirects: ${missing.join(', ')}`).toEqual([]);
  });

  it('sends the partner alias to the landing with its ref, permanently', () => {
    expect(redirects).toMatch(/^\/liga\s+\/\?ref=liga\s+301$/m);
  });

  it('ships a real not-found page that is never indexed', () => {
    expect(read('public/404.html')).toContain('<meta name="robots" content="noindex" />');
  });
});

describe('public/sitemap.xml', () => {
  it('lists only pages whose own canonical is their own URL', () => {
    const locs = [...read('public/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([
      'https://majstr.pro/',
      'https://majstr.pro/kalkulyator-plytky',
      'https://majstr.pro/kalkulyator-gipsokartonu',
      'https://majstr.pro/kalkulyator-shtukaturky',
      'https://majstr.pro/kalkulyator-styazhky',
      'https://majstr.pro/kalkulyator-ploshchi-stin',
    ]);
    expect(read('index.html')).toContain('<link rel="canonical" href="https://majstr.pro/" />');
    expect(read('kalkulyator-plytky.html')).toContain('href="https://majstr.pro/kalkulyator-plytky"');
    expect(read('kalkulyator-gipsokartonu.html')).toContain('href="https://majstr.pro/kalkulyator-gipsokartonu"');
    expect(read('kalkulyator-shtukaturky.html')).toContain('<link rel="canonical" href="https://majstr.pro/kalkulyator-shtukaturky" />');
    expect(read('kalkulyator-styazhky.html')).toContain('<link rel="canonical" href="https://majstr.pro/kalkulyator-styazhky" />');
    expect(read('kalkulyator-ploshchi-stin.html')).toContain('<link rel="canonical" href="https://majstr.pro/kalkulyator-ploshchi-stin" />');
    expect(read('kalkulyator-shtukaturky.html')).toContain('href="https://majstr.pro/kalkulyator-shtukaturky"');
    expect(read('kalkulyator-styazhky.html')).toContain('href="https://majstr.pro/kalkulyator-styazhky"');
  });
});
