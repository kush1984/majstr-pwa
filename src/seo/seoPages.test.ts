import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { seoCalcTables, materialText, exampleText } from '../../scripts/seo-pages-plugin.ts';
import type { CalcSnapshot } from '../../scripts/seo-calc-cases.ts';

/**
 * The public calculator pages, read as TEXT — what a bot without JavaScript gets. They are
 * separate documents (not app routes), so no React test can see them.
 */
const root = path.resolve(__dirname, '../..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const PAGES = [
  { file: 'kalkulyator-plytky.html', kind: 'TILE', h1: 'Калькулятор плитки онлайн — скільки плитки, клею й затирки купити', url: 'https://majstr.pro/kalkulyator-plytky' },
  { file: 'kalkulyator-gipsokartonu.html', kind: 'DRYWALL', h1: 'Калькулятор гіпсокартону та профілю', url: 'https://majstr.pro/kalkulyator-gipsokartonu' },
  { file: 'kalkulyator-shtukaturky.html', kind: 'PLASTER', h1: 'Калькулятор штукатурки — скільки мішків купити на стіни', url: 'https://majstr.pro/kalkulyator-shtukaturky' },
  { file: 'kalkulyator-styazhky.html', kind: 'SCREED', h1: 'Калькулятор стяжки та наливної підлоги — скільки мішків суміші купити', url: 'https://majstr.pro/kalkulyator-styazhky' },
] as const;

const snapshot = JSON.parse(read('src/seo/calc-snapshot.json')) as CalcSnapshot;

/** The page as the build emits it: the snapshot table printed in. */
function built(file: string): string {
  const plugin = seoCalcTables(root);
  const hook = plugin.transformIndexHtml as { handler: (html: string) => string };
  return hook.handler(read(file));
}

describe.each(PAGES)('$file', (page) => {
  it('carries its H1, «Як ми рахуємо», the CTA and the note in the raw HTML', () => {
    const html = read(page.file);
    expect(html).toContain(`<h1>${page.h1}</h1>`);
    expect(html).toContain('<h2>Як ми рахуємо</h2>');
    expect(html).toContain('href="/register"');
    expect(html).toContain('Розрахунок орієнтовний');
    expect(html).toContain(`<link rel="canonical" href="${page.url}" />`);
  });

  it('prints every typical case from the snapshot — no figure typed by hand', () => {
    const html = built(page.file);
    const rows = snapshot.rows.filter((r) => r.calculator === page.kind);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const row of rows) {
      expect(html).toContain(row.label);
      for (const m of row.materials) expect(html).toContain(materialText(m));
    }
    expect(html).not.toContain('<!--SEO_TABLE:');
    expect(html).not.toContain('<!--SEO_EXAMPLE:');
  });

  it("prints only OUR norms — no example carries a visitor's own norm", () => {
    for (const row of snapshot.rows) expect(row.inputs, row.label).not.toHaveProperty('ownNorm');
  });

  it('describes itself as a WebPage with breadcrumbs, and claims no FAQ it does not show', () => {
    const blocks = [...read(page.file).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map((m) => JSON.parse(m[1]) as { '@type': string });
    expect(blocks.map((b) => b['@type'])).toEqual(['WebPage', 'BreadcrumbList']);
  });

  it('has its own 1200 × 630 link preview', () => {
    const html = read(page.file);
    expect(html).toMatch(/og:image" content="https:\/\/majstr\.pro\/og\/og-[a-z]+\.png"/);
    expect(html).toContain('<meta property="og:image:width" content="1200" />');
    expect(html).toContain('summary_large_image');
  });

  it('runs the calculator it names', () => {
    expect(read(page.file)).toContain(`<body data-calculator="${page.kind}" class="seo-page">`);
  });

  it('links every OTHER calculator page from its footer, and not itself', () => {
    const footer = /<footer class="seo-footer">([\s\S]*?)<\/footer>/.exec(read(page.file))?.[1] ?? '';
    for (const other of PAGES) {
      const href = `href="${new URL(other.url).pathname}"`;
      if (other.file === page.file) expect(footer).not.toContain(href);
      else expect(footer, other.file).toContain(href);
    }
  });

  it('invites keeping his own norms next to the CTA', () => {
    expect(read(page.file)).toContain("Збережи свої норми — і застосунок рахуватиме під тебе на кожному об'єкті.");
  });

  it('promises nothing the app does not have', () => {
    const text = read(page.file).toLowerCase();
    for (const word of ['команд', 'компаній', 'аналітик', 'відгук']) {
      expect(text, `«${word}»`).not.toContain(word);
    }
  });
});

describe('kalkulyator-plytky.html', () => {
  it('answers «скільки плитки» in its first paragraph, from the snapshot — the bathroom example', () => {
    const lede = /<p class="seo-lede">([\s\S]*?)<\/p>/.exec(built('kalkulyator-plytky.html'))?.[1] ?? '';
    const bath = snapshot.rows.find((r) => r.id === 'bath');
    if (!bath) throw new Error('calc-snapshot.json has no «bath» case');
    expect(bath.materials[0]?.name).toMatch(/^Плитка 300×600/);
    expect(lede).toContain('2×1,7 м');
    expect(lede).toContain(exampleText(bath));
  });

  it('asks straight or diagonal, says what diagonal adds, and takes an optional box size', () => {
    const html = read('kalkulyator-plytky.html');
    expect(html).toContain('name="layout" value="DIAGONAL"');
    expect(html).toContain('По діагоналі більше підрізки — додаємо 5 % до вашого запасу.');
    expect(html).toMatch(/name="boxArea" inputmode="decimal"/);
  });
});

describe.each([
  { file: 'kalkulyator-shtukaturky.html', id: 'plaster-room', mix: /^Штукатурка гіпсова/ },
  { file: 'kalkulyator-styazhky.html', id: 'screed-room', mix: /^Стяжка цементна/ },
])('$file', ({ file, id, mix }) => {
  it('quotes its room example in the first paragraph, from the snapshot', () => {
    const lede = /<p class="seo-lede">([\s\S]*?)<\/p>/.exec(built(file))?.[1] ?? '';
    const row = snapshot.rows.find((r) => r.id === id);
    if (!row) throw new Error(`calc-snapshot.json has no «${id}» case`);
    expect(row.materials[0]?.name).toMatch(mix);
    expect(lede).toContain(exampleText(row));
  });

  it('says what it does NOT count — the beacons', () => {
    expect(read(file)).toContain('<b>Чого калькулятор не рахує</b>');
    expect(read(file)).toContain('<b>маяки</b>');
  });

  it("points to the visitor's own bag norm in «Як ми рахуємо», under the name the result uses", () => {
    expect(read(file)).toContain('«Своя норма з мішка»');
  });
});

describe('the pages are reachable', () => {
  it('sitemap.xml lists every page, and llms.txt links every page', () => {
    for (const page of PAGES) {
      expect(read('public/sitemap.xml')).toContain(`<loc>${page.url}</loc>`);
      expect(read('public/llms.txt')).toContain(page.url);
    }
  });

  /**
   * The trap: the service worker answers EVERY navigation with the cached SPA shell, so a returning
   * visitor's /kalkulyator-plytky would open the landing page. Read as text, like swUpdate.test.ts.
   */
  it('the service worker does not swallow them — and still serves the app everywhere else', () => {
    const sw = read('src/sw.ts');
    const literal = /const NAVIGATION_DENYLIST = \[([^\]]*)\];/.exec(sw)?.[1] ?? '';
    const denylist = [...literal.matchAll(/\/((?:\\\/|[^/,])+)\//g)].map((m) => new RegExp(m[1]));
    expect(sw).toContain('denylist: NAVIGATION_DENYLIST');
    const swallowed = (url: string) => !denylist.some((re) => re.test(url));
    expect(swallowed('/kalkulyator-plytky')).toBe(false);
    for (const page of PAGES) {
      expect(swallowed(new URL(page.url).pathname), page.url).toBe(false);
    }
    expect(swallowed('/api/projects')).toBe(false);
    for (const appUrl of ['/', '/login', '/projects/123', '/estimates/abc', '/finance']) {
      expect(swallowed(appUrl), appUrl).toBe(true);
    }
  });

  it('vite builds every page as its own document', () => {
    const config = read('vite.config.ts');
    for (const page of PAGES) {
      const name = page.file.replace(/\.html$/, '');
      expect(config).toContain(`'${name}': path.resolve(__dirname, '${page.file}')`);
    }
  });

  it('the landing footer links every calculator page', () => {
    const landing = read('src/features/landing/LandingPage.tsx');
    for (const page of PAGES) expect(landing).toContain(`href="${new URL(page.url).pathname}"`);
  });

  it('every page has its link-preview card on disk', () => {
    for (const page of PAGES) {
      const image = /og:image" content="https:\/\/majstr\.pro(\/og\/[a-z-]+\.png)"/.exec(read(page.file))?.[1];
      expect(image, page.file).toBeDefined();
      expect(existsSync(path.join(root, 'public', image ?? '')), image).toBe(true);
    }
  });
});
