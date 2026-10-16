// YouTube channel art — the banner, its safe-area preview, the watermark and the avatar — rendered
// from HTML by Playwright, the same way scripts/og-images.ts renders the link previews, with the
// landing's own palette (src/styles: --l-paper, --l-amber, --l-graphite, --l-muted).
//
//   npm run youtube:assets   → marketing/youtube/*.png
//
// Not public/: the site never serves these; they are uploaded to the channel by hand.

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'marketing', 'youtube');

const PAPER = '#f7f1e7';
const PAPER_2 = '#ede2d1';
const AMBER = '#f5821f';
const INK = '#3a2519';
const MUTED = '#705c47';
const FONT = "Inter, 'Segoe UI', Roboto, Arial, sans-serif";

/** YouTube's banner: 2048 × 1152, and only the centre 1235 × 338 is shown on every device. */
const BANNER = { width: 2048, height: 1152 };
const SAFE = { width: 1235, height: 338 };
const SAFE_LEFT = (BANNER.width - SAFE.width) / 2;
const SAFE_TOP = (BANNER.height - SAFE.height) / 2;

function bannerHtml(showSafeArea: boolean): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: ${BANNER.width}px; height: ${BANNER.height}px; overflow: hidden; font-family: ${FONT}; color: ${INK};
         background: radial-gradient(ellipse at 50% 50%, ${PAPER} 45%, ${PAPER_2} 100%); position: relative; }
  .safe { position: absolute; left: ${SAFE_LEFT}px; top: ${SAFE_TOP}px; width: ${SAFE.width}px; height: ${SAFE.height}px;
          display: flex; align-items: center; justify-content: center; gap: 56px; }
  .mark { flex: none; display: grid; place-items: center; width: 200px; height: 200px; border-radius: 48px;
          background: ${AMBER}; color: #fff; font-size: 132px; font-weight: 800; }
  h1 { font-size: 60px; line-height: 1.08; font-weight: 800; letter-spacing: -1.5px; }
  h1 em { font-style: normal; color: ${AMBER}; }
  .site { margin-top: 18px; font-size: 32px; font-weight: 600; color: ${MUTED}; }
  .frame { position: absolute; left: ${SAFE_LEFT}px; top: ${SAFE_TOP}px; width: ${SAFE.width}px; height: ${SAFE.height}px;
           border: 4px dashed #d92d20; }
  </style></head><body>
  <div class="safe" id="safe">
    <div class="mark">M</div>
    <div><h1>Порахуй роботу.<br><em>Надішли кошторис.</em><br>Отримай підпис.</h1><div class="site">majstr.pro</div></div>
  </div>
  ${showSafeArea ? '<div class="frame"></div>' : ''}
  </body></html>`;
}

/** The «M» of the logo on a transparent ground — YouTube lays it over the video's corner. */
function watermarkHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; } html, body { background: transparent; }
  .mark { width: 150px; height: 150px; display: grid; place-items: center; border-radius: 36px; background: ${AMBER};
          color: #fff; font: 800 100px/1 ${FONT}; }
  </style></head><body><div class="mark">M</div></body></html>`;
}

/** Full-bleed brand square: YouTube crops the avatar to a circle, so the «M» stays well inside it. */
function avatarHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; }
  body { width: 800px; height: 800px; display: grid; place-items: center; background: ${AMBER};
         color: #fff; font: 800 440px/1 ${FONT}; }
  </style></head><body>M</body></html>`;
}

/** Fails the run if any text of the banner pokes out of the safe area — what a phone would cut off. */
async function assertInsideSafeArea(page: Page): Promise<void> {
  const outside = await page.evaluate(
    ({ left, top, width, height }) => {
      const bad: string[] = [];
      for (const el of Array.from(document.querySelectorAll('#safe *'))) {
        const r = el.getBoundingClientRect();
        if (r.left < left || r.top < top || r.right > left + width || r.bottom > top + height) {
          bad.push(`${el.tagName} ${Math.round(r.left)},${Math.round(r.top)}–${Math.round(r.right)},${Math.round(r.bottom)}`);
        }
      }
      return bad;
    },
    { left: SAFE_LEFT, top: SAFE_TOP, width: SAFE.width, height: SAFE.height },
  );
  if (outside.length > 0) throw new Error(`Banner text outside the safe area: ${outside.join('; ')}`);
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    const banner = await browser.newPage({ viewport: BANNER, deviceScaleFactor: 1 });
    for (const [file, frame] of [['banner.png', false], ['banner-safe-area-preview.png', true]] as const) {
      await banner.setContent(bannerHtml(frame), { waitUntil: 'load' });
      await assertInsideSafeArea(banner);
      await banner.screenshot({ path: path.join(outDir, file), type: 'png' });
      console.log(`  ✓ marketing/youtube/${file}`);
    }

    const watermark = await browser.newPage({ viewport: { width: 150, height: 150 }, deviceScaleFactor: 1 });
    await watermark.setContent(watermarkHtml(), { waitUntil: 'load' });
    await watermark.screenshot({ path: path.join(outDir, 'watermark.png'), type: 'png', omitBackground: true });
    console.log('  ✓ marketing/youtube/watermark.png');

    const avatar = await browser.newPage({ viewport: { width: 800, height: 800 }, deviceScaleFactor: 1 });
    await avatar.setContent(avatarHtml(), { waitUntil: 'load' });
    await avatar.screenshot({ path: path.join(outDir, 'avatar.png'), type: 'png' });
    console.log('  ✓ marketing/youtube/avatar.png');
  } finally {
    await browser.close();
  }
}

await main();
