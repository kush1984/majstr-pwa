// The calculator pages' typical-case table, taken from the public endpoint — never typed by hand.
//
//   npm run seo:snapshot            write src/seo/calc-snapshot.json from the live endpoint
//   npm run seo:check               compare the file with the live endpoint; exit 1 on any drift
//
// SEO_API_BASE picks the backend (default http://localhost:8080 — `./gradlew bootRun`; prod is
// https://api.majstr.pro once the endpoint is deployed).

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CALC_CASES, reduce, type CalcSnapshot, type SnapshotMaterial } from './seo-calc-cases.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src', 'seo', 'calc-snapshot.json');
const api = (process.env.SEO_API_BASE ?? 'http://localhost:8080').replace(/\/$/, '');
const check = process.argv.includes('--check');

async function live(): Promise<CalcSnapshot> {
  const rows = [];
  for (const c of CALC_CASES) {
    const res = await fetch(`${api}/api/public/materials/calc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calculator: c.calculator, inputs: c.inputs }),
    });
    if (!res.ok) throw new Error(`${c.label}: HTTP ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { materials: SnapshotMaterial[] };
    rows.push({ ...(c.id ? { id: c.id } : {}), label: c.label, calculator: c.calculator, inputs: c.inputs, materials: reduce(body.materials) });
  }
  return { rows };
}

const current = await live();
const text = `${JSON.stringify(current, null, 2)}\n`;
if (check) {
  const stored = readFileSync(file, 'utf8');
  if (stored !== text) {
    console.error(`✗ ${path.relative(root, file)} differs from ${api} — run npm run seo:snapshot and rebuild.`);
    process.exit(1);
  }
  console.log(`✓ the calculator tables match ${api}`);
} else {
  writeFileSync(file, text);
  console.log(`✓ wrote ${path.relative(root, file)} from ${api} (${current.rows.length} cases)`);
}
