// Prints the calculator pages' typical-case tables into the HTML at build (and dev) time, from
// src/seo/calc-snapshot.json — so a bot without JavaScript reads every figure, and no figure is
// ever typed by hand. A page marks the spot with <!--SEO_TABLE:TILE--> / <!--SEO_TABLE:DRYWALL-->, and
// quotes one case in its prose with <!--SEO_EXAMPLE:<id>-->.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import type { CalcSnapshot, SnapshotMaterial, SnapshotRow } from './seo-calc-cases.ts';

const UNIT: Record<string, string> = {
  KG: 'кг', M2: 'м²', LINEAR_METER: 'м.п.', PIECE: 'шт', LITRE: 'л', M3: 'м³',
};

/** «мішків: 3» — the genitive plural reads right for any count, so no plural rules are needed. */
const PACKAGE_GENITIVE: Record<string, string> = {
  мішок: 'мішків', пачка: 'пачок', каністра: 'каністр', лист: 'листів', упаковка: 'упаковок',
  відро: 'відер', рулон: 'рулонів', плитка: 'плиток',
};

const number = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 });

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function materialText(m: SnapshotMaterial): string {
  const amount = `${number.format(m.quantity)} ${UNIT[m.unit] ?? m.unit}`;
  if (m.packages == null || m.packageName == null) return amount;
  const pack = PACKAGE_GENITIVE[m.packageName] ?? m.packageName;
  return `${pack}: ${m.packages} (${amount})`;
}

export function tableHtml(rows: SnapshotRow[]): string {
  const body = rows.map((r) => {
    const items = r.materials
      .map((m) => `<li><span>${escapeHtml(m.name)}</span> — <b>${escapeHtml(materialText(m))}</b></li>`)
      .join('');
    return `<tr><th scope="row">${escapeHtml(r.label)}</th><td><ul>${items}</ul></td></tr>`;
  }).join('');
  return `<table class="seo-table"><thead><tr><th scope="col">Випадок</th><th scope="col">Що купити</th></tr></thead><tbody>${body}</tbody></table>`;
}

/** «Плитка 300×600 мм — плиток: 106 (19,08 м²); Клей … — мішків: 6 (150 кг)» — a case's answer as a sentence. */
export function exampleText(row: SnapshotRow): string {
  return row.materials.map((m) => `${escapeHtml(m.name)} — ${escapeHtml(materialText(m))}`).join('; ');
}

export function seoCalcTables(root: string): Plugin {
  return {
    name: 'majstr-seo-calc-tables',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!html.includes('<!--SEO_TABLE:') && !html.includes('<!--SEO_EXAMPLE:')) return html;
        const snapshot = JSON.parse(
          readFileSync(path.join(root, 'src', 'seo', 'calc-snapshot.json'), 'utf8'),
        ) as CalcSnapshot;
        return html
          .replace(/<!--SEO_TABLE:(TILE|DRYWALL)-->/g, (_, kind: string) =>
            tableHtml(snapshot.rows.filter((r) => r.calculator === kind)))
          .replace(/<!--SEO_EXAMPLE:([a-z0-9-]+)-->/g, (_, id: string) => {
            const row = snapshot.rows.find((r) => r.id === id);
            if (!row) throw new Error(`calc-snapshot.json has no case «${id}» — run npm run seo:snapshot`);
            return exampleText(row);
          });
      },
    },
  };
}
