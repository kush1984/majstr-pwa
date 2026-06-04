// Generates the PWA PNG icons from the Majstr brand mark, so the manifest +
// iOS apple-touch-icon + push-notification icon all resolve to a real file.
//
// Run with `npm run generate-icons`. The "M" is drawn as a stroked vector path
// (not text) so rendering is deterministic — no system-font dependency.
//
// Outputs (public/icons/):
//   icon-192.png            192  — manifest "any"
//   icon-512.png            512  — manifest "any"
//   icon-maskable-512.png   512  — manifest "maskable" (logo inside 80% safe zone)
//   apple-touch-icon.png    180  — iOS home-screen / standalone

import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BRAND = '#ea580c';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'icons');
mkdirSync(outDir, { recursive: true });

/** The "M" as a single stroked polyline on a 512×512 canvas. */
function mMark(scale = 1) {
  // Centre-scale the mark toward the middle (used to keep the maskable
  // variant inside the central 80% safe zone).
  const inset = (512 * (1 - scale)) / 2;
  const t = `translate(${inset} ${inset}) scale(${scale})`;
  return `<path transform="${t}"
      d="M150 360 V160 L256 292 L362 160 V360"
      fill="none" stroke="#ffffff" stroke-width="58"
      stroke-linejoin="round" stroke-linecap="round"/>`;
}

/** Rounded-corner tile (manifest "any" + browsers). */
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="${BRAND}"/>
  ${mMark(1)}
</svg>`;

/** Full-bleed tile (no rounded corners — the OS applies its own mask). */
const fullBleed = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BRAND}"/>
  ${mMark(scale)}
</svg>`;

function render(svg, size, file) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } })
    .render()
    .asPng();
  writeFileSync(path.join(outDir, file), png);
  console.log(`  ✓ ${file} (${size}×${size})`);
}

console.log('Generating PWA icons →', path.relative(root, outDir));
render(rounded, 192, 'icon-192.png');
render(rounded, 512, 'icon-512.png');
render(fullBleed(0.8), 512, 'icon-maskable-512.png'); // logo inside 80% safe zone
render(fullBleed(1), 180, 'apple-touch-icon.png'); // iOS rounds the corners itself
