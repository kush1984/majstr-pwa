import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { seoCalcTables, moneyText } from '../../scripts/seo-pages-plugin.ts';
import { SAMPLE_LINES, lineTotalKop, sampleTotalKop } from './sampleEstimate.ts';
import {
  SAMPLE_ACT_ADDITIONAL,
  actAdditionalKop,
  actAdvanceKop,
  actGrandKop,
  actPayableKop,
} from './sampleAct.ts';
import { hryvniaInWords } from './hryvniaInWords.ts';

/** /zrazok-akta read as TEXT — what a bot without JavaScript gets. */
const root = path.resolve(__dirname, '../..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const FILE = 'zrazok-akta.html';
const URL = 'https://majstr.pro/zrazok-akta';

function built(): string {
  const hook = seoCalcTables(root).transformIndexHtml as { handler: (html: string) => string };
  return hook.handler(read(FILE));
}

describe('the sample act', () => {
  it('closes every line of the sample estimate and adds the extra job on top', () => {
    expect(actGrandKop()).toBe(sampleTotalKop() + actAdditionalKop());
  });

  it('offsets the estimate\'s 30 % advance, to the kopeck, and never goes below zero', () => {
    expect(actAdvanceKop()).toBe(Math.round(sampleTotalKop() * 0.3));
    expect(actPayableKop()).toBe(actGrandKop() - actAdvanceKop());
    expect(actPayableKop()).toBeGreaterThan(0);
  });
});

describe(FILE, () => {
  it('prints both parts, the totals and the sum in words into the HTML', () => {
    const html = built();
    expect(html).not.toContain('<!--SEO_');
    expect(html).toContain('<h1>Зразок акта виконаних робіт на ремонт</h1>');
    expect(html.indexOf('І. Виконані роботи')).toBeLessThan(html.indexOf('ІІ. Додаткові роботи'));
    // Numbering runs on into the additional part, as the act PDF's does.
    expect(html).toContain(`${SAMPLE_LINES.length + 1}. ${SAMPLE_ACT_ADDITIONAL[0].name}`);
    expect(html).toContain(moneyText(lineTotalKop(SAMPLE_ACT_ADDITIONAL[0])));
    expect(html).toContain(`<th scope="row">Разом за актом</th><td class="seo-estimate-sum">${moneyText(actGrandKop())}</td>`);
    expect(html).toContain(`− ${moneyText(actAdvanceKop())}`);
    expect(html).toContain(`<th scope="row">До сплати</th><td class="seo-estimate-sum">${moneyText(actPayableKop())}</td>`);
    expect(html).toContain(`Сума до сплати прописом: ${hryvniaInWords(actPayableKop())}.`);
  });

  it('answers in its first paragraph and links the estimate it closes', () => {
    const lede = /<p class="seo-lede">([\s\S]*?)<\/p>/.exec(built())?.[1] ?? '';
    expect(lede).toContain('<a href="/zrazok-koshtorysu">');
    expect(lede).toContain(`${SAMPLE_LINES.length + SAMPLE_ACT_ADDITIONAL.length} позицій`);
    expect(lede).toContain(`до сплати ${moneyText(actPayableKop())} грн`);
  });

  it('uses the act PDF\'s own wording, and claims no legal equivalence', () => {
    const html = read(FILE);
    expect(html).toContain('Роботи виконано в повному обсязі та з належною якістю. Сторони претензій одна до одної не мають.');
    expect(html).toContain('«Підтвердити приймання робіт»');
    expect(html).not.toMatch(/КБ-2в|юридичн\S* сил|рівноцінн/);
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

  it('records first touch and nothing else', () => {
    const scripts = [...read(FILE).matchAll(/<script([^>]*)>/g)]
      .map((m) => m[1])
      .filter((attrs) => !attrs.includes('application/ld+json'));
    expect(scripts).toEqual([' type="module" src="/src/seo/samplePage.ts"']);
  });

  it('is its own canonical page with its own 1200 × 630 preview', () => {
    const html = read(FILE);
    expect(html).toContain(`<link rel="canonical" href="${URL}" />`);
    expect(html).toContain('<meta property="og:image" content="https://majstr.pro/og/og-zrazok-akta.png" />');
    expect(existsSync(path.join(root, 'public/og/og-zrazok-akta.png'))).toBe(true);
  });
});

describe('the sample act page is reachable', () => {
  it('is a build input, in the sitemap and in llms.txt', () => {
    expect(read('vite.config.ts')).toContain("'zrazok-akta': path.resolve(__dirname, 'zrazok-akta.html')");
    expect(read('public/sitemap.xml')).toContain(`<loc>${URL}</loc>`);
    expect(read('public/llms.txt')).toContain(URL);
  });

  it('is not swallowed by the service worker', () => {
    const literal = /const NAVIGATION_DENYLIST = \[([^\]]*)\];/.exec(read('src/sw.ts'))?.[1] ?? '';
    const denylist = [...literal.matchAll(/\/((?:\\\/|[^/,])+)\//g)].map((m) => new RegExp(m[1]));
    expect(denylist.some((re) => re.test('/zrazok-akta'))).toBe(true);
  });

  it.each([
    'kalkulyator-plytky.html',
    'kalkulyator-gipsokartonu.html',
    'kalkulyator-shtukaturky.html',
    'kalkulyator-styazhky.html',
    'kalkulyator-ploshchi-stin.html',
    'zrazok-koshtorysu.html',
    'src/features/landing/LandingPage.tsx',
  ])('is linked from %s', (file) => {
    expect(read(file)).toContain('href="/zrazok-akta"');
  });
});
