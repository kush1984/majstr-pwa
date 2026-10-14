/// <reference lib="dom" />
// Landing photos: the owner's originals in design/landing/*.png → WebP in public/landing/, in the
// widths the page's `srcset` asks for.
//
//   npm run landing:photos
//
// The PNGs stay OUT of public/ on purpose — everything in public/ ships in the bundle, and a 2 MB
// PNG is exactly what the page must not download. Encoding is done by Playwright's Chromium through
// a canvas, the same way landing-shots does it, so no image dependency is added. (Chromium's canvas
// cannot encode AVIF, so there is WebP only — every browser that runs the app reads it.)

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'design', 'landing');
const outDir = path.join(root, 'public', 'landing');

/** The widths the page's `srcset` lists; a source narrower than one is not upscaled. */
const PHOTO_WIDTHS = [640, 960, 1280, 1536] as const;
const QUALITY = 0.8;

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const sources = readdirSync(srcDir).filter((f) => f.toLowerCase().endsWith('.png'));
  if (sources.length === 0) {
    console.log(`No PNG in ${srcDir}`);
    return;
  }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    for (const file of sources) {
      const name = path.basename(file, path.extname(file));
      const b64 = readFileSync(path.join(srcDir, file)).toString('base64');
      const out = await page.evaluate(
        async ({ b64, widths, quality }) => {
          const img = new Image();
          img.src = `data:image/png;base64,${b64}`;
          await img.decode();
          const results: Array<{ width: number; height: number; data: string }> = [];
          for (const target of widths.filter((w) => w <= img.naturalWidth)) {
            const height = Math.round((img.naturalHeight * target) / img.naturalWidth);
            const canvas = document.createElement('canvas');
            canvas.width = target;
            canvas.height = height;
            const ctx = canvas.getContext('2d')!;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, target, height);
            results.push({ width: target, height, data: canvas.toDataURL('image/webp', quality) });
          }
          return { natural: [img.naturalWidth, img.naturalHeight], results };
        },
        { b64, widths: [...PHOTO_WIDTHS], quality: QUALITY },
      );
      for (const r of out.results) {
        const target = path.join(outDir, `${name}-${r.width}.webp`);
        writeFileSync(target, Buffer.from(r.data.split(',')[1], 'base64'));
        console.log(`  ✓ ${path.relative(root, target)}  ${r.width}×${r.height}`);
      }
      console.log(`  (${file}: ${out.natural.join('×')})`);
    }
  } finally {
    await browser.close();
  }
}

await main();
