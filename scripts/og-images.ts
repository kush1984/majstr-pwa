// Link-preview cards (1200 × 630) for Viber, Telegram and the rest — rendered from an HTML template
// by Playwright, with a REAL app screen (public/landing/shot-editor.webp, from landing:shots) in a
// CSS phone frame. Re-run after `npm run landing:shots`, so the preview follows the interface.
//
//   npm run og:images   → public/og/og-default.png and one card per calculator page

import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'og');

interface Card {
  file: string;
  badge: string;
  /** Lines of the headline; the middle one is drawn in the brand colour. */
  lines: string[];
  sub: string;
}

const CARDS: Card[] = [
  {
    file: 'og-default.png',
    badge: 'PWA для майстрів і бригадирів',
    lines: ['Порахуй роботу.', 'Надішли кошторис.', 'Отримай підпис.'],
    sub: 'Від замірів до підпису клієнта — в одному телефоні.',
  },
  {
    file: 'og-plytky.png',
    badge: 'Безкоштовний калькулятор',
    lines: ['Калькулятор', 'плитки онлайн', 'з клеєм і затиркою'],
    sub: 'Скільки плитки, клею й затирки купити — у м², штуках і коробках.',
  },
  {
    file: 'og-gipsokartonu.png',
    badge: 'Безкоштовний калькулятор',
    lines: ['Калькулятор', 'гіпсокартону', 'та профілю'],
    sub: 'Листи ГКЛ, профіль, підвіси й саморізи — для стелі, стіни чи перегородки.',
  },
  {
    file: 'og-shtukaturky.png',
    badge: 'Безкоштовний калькулятор',
    lines: ['Калькулятор', 'штукатурки', 'для стін'],
    sub: 'Скільки мішків гіпсової чи цементної штукатурки й ґрунтовки купити — за площею й товщиною.',
  },
  {
    file: 'og-styazhky.png',
    badge: 'Безкоштовний калькулятор',
    lines: ['Калькулятор', 'стяжки', 'та наливної підлоги'],
    sub: 'Мішки суміші, ґрунтовка, сітка, плівка й демпферна стрічка — за площею й товщиною.',
  },
  {
    file: 'og-ploshchi-stin.png',
    badge: 'Безкоштовний калькулятор',
    lines: ['Калькулятор', 'площі стін', 'з вікнами й дверима'],
    sub: 'Площа стін без прорізів, стеля, підлога й плінтус — за розмірами кімнати.',
  },
  {
    file: 'og-zrazok-koshtorysu.png',
    badge: 'Зразок документа',
    lines: ['Зразок', 'кошторису', 'на ремонт ванної'],
    sub: 'Роботи з кількостями й цінами, підсумок і умови — і що має бути в кожному кошторисі.',
  },
  {
    file: 'og-zrazok-akta.png',
    badge: 'Зразок документа',
    lines: ['Зразок акта', 'виконаних робіт', 'із сумою прописом'],
    sub: 'Роботи за кошторисом, додаткові роботи, аванс і сума до сплати — на прикладі ремонту ванної.',
  },
];

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function html(card: Card, shot: string): string {
  const [first, middle, last] = card.lines.map(escapeHtml);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; overflow: hidden; background: #fff; color: #3a2519;
         font-family: Inter, 'Segoe UI', Roboto, Arial, sans-serif; display: flex; }
  .text { flex: 1; padding: 64px 0 56px 72px; display: flex; flex-direction: column; }
  .logo { display: flex; align-items: center; gap: 12px; font-size: 30px; font-weight: 800; }
  .logo span { display: grid; place-items: center; width: 46px; height: 46px; border-radius: 12px; background: #f5821f; color: #fff; }
  .badge { align-self: flex-start; margin-top: 44px; padding: 6px 14px; border-radius: 999px; background: #fdebd9; color: #e06c00; font-size: 20px; font-weight: 600; }
  h1 { margin-top: 18px; font-size: 62px; line-height: 1.05; font-weight: 800; letter-spacing: -1.5px; }
  h1 em { font-style: normal; color: #f5821f; }
  p { margin-top: auto; font-size: 25px; color: #705c47; max-width: 620px; }
  .phone-wrap { width: 420px; position: relative; background: #fdf3e7; }
  .phone { position: absolute; left: 70px; top: 52px; width: 290px; border-radius: 40px; background: #3a2519; padding: 9px;
           box-shadow: 0 30px 60px -24px rgba(58,37,25,.55); }
  .phone img { display: block; width: 100%; border-radius: 32px; }
  </style></head><body>
  <div class="text">
    <div class="logo"><span>M</span>Majstr.pro</div>
    <div class="badge">${escapeHtml(card.badge)}</div>
    <h1>${first}<br><em>${middle}</em><br>${last}</h1>
    <p>${escapeHtml(card.sub)}</p>
  </div>
  <div class="phone-wrap"><div class="phone"><img src="${shot}"></div></div>
  </body></html>`;
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const shot = `data:image/webp;base64,${readFileSync(path.join(root, 'public', 'landing', 'shot-editor.webp')).toString('base64')}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  try {
    for (const card of CARDS) {
      await page.setContent(html(card, shot), { waitUntil: 'load' });
      await page.screenshot({ path: path.join(outDir, card.file), type: 'png' });
      console.log(`  ✓ public/og/${card.file}`);
    }
  } finally {
    await browser.close();
  }
}

await main();
