import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { seoCalcTables, moneyText } from '../../scripts/seo-pages-plugin.ts';
import {
  SAMPLE_FLOOR_M2,
  SAMPLE_LINES,
  SAMPLE_WALLS_M2,
  lineTotalKop,
  sampleSections,
  sampleTotalKop,
} from './sampleEstimate.ts';

/** /zrazok-koshtorysu read as TEXT — what a bot without JavaScript gets. */
const root = path.resolve(__dirname, '../..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const FILE = 'zrazok-koshtorysu.html';
const URL = 'https://majstr.pro/zrazok-koshtorysu';

function built(): string {
  const hook = seoCalcTables(root).transformIndexHtml as { handler: (html: string) => string };
  return hook.handler(read(FILE));
}

const number = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 });

describe('the sample estimate', () => {
  it('sums its lines in kopecks — 20,4 m² × 224 is 4 569,60, not a float', () => {
    const demolition = SAMPLE_LINES.find((l) => l.name === 'Демонтаж плитки');
    expect(demolition && lineTotalKop(demolition)).toBe(456960);
    expect(sampleTotalKop()).toBe(SAMPLE_LINES.reduce((s, l) => s + lineTotalKop(l), 0));
  });

  it('keeps every line priced and counted, and every section in the order it first appears', () => {
    for (const line of SAMPLE_LINES) {
      expect(line.quantity, line.name).toBeGreaterThan(0);
      expect(line.price, line.name).toBeGreaterThan(0);
    }
    const sections = sampleSections();
    expect(sections.map((s) => s.name)).toEqual([...new Set(SAMPLE_LINES.map((l) => l.section))]);
    expect(sections.flatMap((s) => s.lines)).toHaveLength(SAMPLE_LINES.length);
  });

  it('tiles exactly the walls and the floor the page describes', () => {
    const tiled = SAMPLE_LINES.filter((l) => l.name.startsWith('Укладання плитки'));
    expect(tiled.map((l) => l.quantity)).toEqual([SAMPLE_WALLS_M2, SAMPLE_FLOOR_M2]);
  });
});

describe(FILE, () => {
  it('prints the whole table and its total into the HTML — nothing left for JavaScript', () => {
    const html = built();
    expect(html).not.toContain('<!--SEO_');
    expect(html).toContain('<h1>Зразок кошторису на ремонт ванної кімнати</h1>');
    for (const [i, line] of SAMPLE_LINES.entries()) {
      expect(html).toContain(`${i + 1}. ${line.name}`);
      expect(html).toContain(moneyText(lineTotalKop(line)));
    }
    expect(html).toContain(`<th scope="row">Разом</th><td class="seo-estimate-sum">${moneyText(sampleTotalKop())}</td>`);
  });

  it('answers in its first paragraph: the areas, how many positions and the total', () => {
    const lede = /<p class="seo-lede">([\s\S]*?)<\/p>/.exec(built())?.[1] ?? '';
    expect(lede).toContain(`стіни ${number.format(SAMPLE_WALLS_M2)} м²`);
    expect(lede).toContain(`підлога ${number.format(SAMPLE_FLOOR_M2)} м²`);
    expect(lede).toContain(`${SAMPLE_LINES.length} позицій робіт на ${moneyText(sampleTotalKop())} грн`);
  });

  it('claims in its FAQ markup only what the page shows, word for word', () => {
    const html = read(FILE);
    const faq = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map((m) => JSON.parse(m[1]) as { '@type': string; mainEntity?: { name: string; acceptedAnswer: { text: string } }[] })
      .find((j) => j['@type'] === 'FAQPage');
    expect(faq?.mainEntity).toHaveLength(3);
    for (const q of faq?.mainEntity ?? []) {
      expect(html).toContain(`<h3>${q.name}</h3>`);
      expect(html).toContain(`<p>${q.acceptedAnswer.text}</p>`);
    }
  });

  it('runs one script, and it only records where the visitor came from', () => {
    const scripts = [...read(FILE).matchAll(/<script([^>]*)>/g)]
      .map((m) => m[1])
      .filter((attrs) => !attrs.includes('application/ld+json'));
    expect(scripts).toEqual([' type="module" src="/src/seo/samplePage.ts"']);
    const page = read('src/seo/samplePage.ts');
    expect(page).toContain('captureUtmFromUrl(window.location.search)');
    expect(page).toContain('captureFirstTouch(document.referrer, window.location.pathname, window.location.hostname)');
  });

  it('is its own canonical page with its own 1200 × 630 preview', () => {
    const html = read(FILE);
    expect(html).toContain(`<link rel="canonical" href="${URL}" />`);
    expect(html).toContain('<meta property="og:image" content="https://majstr.pro/og/og-zrazok-koshtorysu.png" />');
    expect(existsSync(path.join(root, 'public/og/og-zrazok-koshtorysu.png'))).toBe(true);
  });
});

describe('the sample page is reachable', () => {
  it('is a build input, in the sitemap and in llms.txt', () => {
    expect(read('vite.config.ts')).toContain("'zrazok-koshtorysu': path.resolve(__dirname, 'zrazok-koshtorysu.html')");
    expect(read('public/sitemap.xml')).toContain(`<loc>${URL}</loc>`);
    expect(read('public/llms.txt')).toContain(URL);
  });

  it('is not swallowed by the service worker', () => {
    const literal = /const NAVIGATION_DENYLIST = \[([^\]]*)\];/.exec(read('src/sw.ts'))?.[1] ?? '';
    const denylist = [...literal.matchAll(/\/((?:\\\/|[^/,])+)\//g)].map((m) => new RegExp(m[1]));
    expect(denylist.some((re) => re.test('/zrazok-koshtorysu'))).toBe(true);
  });

  it.each([
    'kalkulyator-plytky.html',
    'kalkulyator-gipsokartonu.html',
    'kalkulyator-shtukaturky.html',
    'kalkulyator-styazhky.html',
    'kalkulyator-ploshchi-stin.html',
    'src/features/landing/LandingPage.tsx',
  ])('is linked from %s', (file) => {
    expect(read(file)).toContain('href="/zrazok-koshtorysu"');
  });
});
