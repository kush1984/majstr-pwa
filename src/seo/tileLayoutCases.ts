import { countPosition, layoutSurface, tilesByArea, type Opening, type SurfaceInput } from '../lib/tileLayout.ts';

/**
 * The tile page's layout examples (kalkulyator-plytky.html), counted AT BUILD by the same engine the
 * page and the app run — so the table and the first paragraph can never print a figure the engine would
 * not give. Change the engine, and the next build prints the new figures (seoPages.test pins that the
 * page holds exactly what this module computes). Relative imports only: the build plugin loads this
 * file in Node, where the `@/` alias does not exist.
 */

export interface LayoutCase {
  id: string;
  label: string;
  tile: { w: number; h: number };
  formatLabel: string;
  walls: { width: number; height: number; openings?: Opening[] }[];
}

const JOINT = 2;
/** The area calculator's default allowance, so the two figures in a row compare like for like. */
export const LAYOUT_CASE_WASTE = 10;

export const LAYOUT_CASES: LayoutCase[] = [
  {
    // The bathroom the first paragraph quotes by area: 2 × 1,7 m, tiled to 2,5 m, a 0,7 × 2,0 door in the
    // middle of a 2 m wall.
    id: 'bath',
    label: 'Ванна 2×1,7 м, стіни до 2,5 м, двері 0,7×2,0 посередині стіни 2 м',
    tile: { w: 600, h: 300 },
    formatLabel: '300×600, лежача',
    walls: [
      { width: 2000, height: 2500, openings: [{ x: 650, y: 0, w: 700, h: 2000 }] },
      { width: 1700, height: 2500 },
      { width: 2000, height: 2500 },
      { width: 1700, height: 2500 },
    ],
  },
  {
    id: 'wall-large',
    label: 'Одна стіна 2×2,7 м',
    tile: { w: 600, h: 1200 },
    formatLabel: '600×1200, стояча',
    walls: [{ width: 2000, height: 2700 }],
  },
  {
    id: 'floor',
    label: 'Підлога 3×2,5 м',
    tile: { w: 600, h: 600 },
    formatLabel: '600×600',
    walls: [{ width: 3000, height: 2500 }],
  },
];

export interface LayoutCaseResult {
  /** As measured: the surfaces less the openings, m². */
  area: number;
  /** Bought, spare included — offcuts reused / every cut from a fresh tile. */
  buyMin: number;
  buyMax: number;
  /** What the area calculator buys for the same m² at {@link LAYOUT_CASE_WASTE} %. */
  byArea: number;
  /** The narrowest narrow strip the layout leaves, and on which side; null when there is none. */
  narrow: { side: 'L' | 'R' | 'B' | 'T'; mm: number } | null;
}

export function layoutCase(c: LayoutCase): LayoutCaseResult {
  const layouts = c.walls.map((w) => layoutSurface({
    width: w.width,
    height: w.height,
    tile: c.tile,
    joint: JOINT,
    edgeGap: JOINT,
    pattern: 'STRAIGHT',
    hStart: 'SYMMETRIC',
    vStart: c.id === 'floor' ? 'SYMMETRIC' : 'CORNER',
    openings: w.openings,
  } satisfies SurfaceInput));
  const count = countPosition(layouts, c.tile);
  const area = c.walls.reduce((a, w) =>
    a + (w.width * w.height - (w.openings ?? []).reduce((o, x) => o + x.w * x.h, 0)) / 1e6, 0);
  const strips = layouts.flatMap((l) => l.edges.filter((e) => e.narrow));
  const worst = strips.reduce<(typeof strips)[number] | null>((a, e) => (!a || e.min < a.min ? e : a), null);
  return {
    narrow: worst ? { side: worst.side, mm: Math.round(worst.min) } : null,
    area: Math.round(area * 100) / 100,
    buyMin: count.minTiles + count.spare,
    buyMax: count.maxTiles + count.spare,
    byArea: tilesByArea(area, c.tile, LAYOUT_CASE_WASTE),
  };
}

export function layoutCaseById(id: string): LayoutCase {
  const c = LAYOUT_CASES.find((x) => x.id === id);
  if (!c) throw new Error(`no tile layout case «${id}»`);
  return c;
}

const number = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 });
const range = (r: LayoutCaseResult) => (r.buyMin === r.buyMax ? `${r.buyMax}` : `${r.buyMin}–${r.buyMax}`);

const SIDE_WORD: Record<'L' | 'R' | 'B' | 'T', string> = { L: 'зліва', R: 'справа', B: 'знизу', T: 'вгорі' };

/** The first paragraph's layout sentence, every figure from the engine: the range, what by-area misses, the strip. */
export function layoutCaseText(c: LayoutCase): string {
  const r = layoutCase(c);
  const verdict = r.byArea < r.buyMin
    ? `тобто за площею забракло б щонайменше ${r.buyMin - r.byArea}`
    : 'тобто за площею вистачить';
  const strip = r.narrow ? `; ${SIDE_WORD[r.narrow.side]} лишиться вузька смужка ${r.narrow.mm} мм` : '';
  return `${range(r)} плиток з запасом на бій, ${verdict}${strip}`;
}

export function layoutTableHtml(cases: LayoutCase[], escape: (s: string) => string): string {
  const body = cases.map((c) => {
    const r = layoutCase(c);
    const verdict = r.byArea < r.buyMin
      ? `забракло б щонайменше ${r.buyMin - r.byArea}`
      : r.byArea > r.buyMax ? `зайвих щонайменше ${r.byArea - r.buyMax}` : 'вистачить';
    return `<tr><th scope="row">${escape(c.label)}<br><small>${escape(c.formatLabel)} · ${escape(number.format(r.area))} м²</small></th>`
      + `<td><b>${escape(range(r))} шт</b></td><td>${r.byArea} шт — ${escape(verdict)}</td></tr>`;
  }).join('');
  return '<table class="seo-table"><thead><tr><th scope="col">Випадок</th>'
    + '<th scope="col">По стінах, з підрізкою</th>'
    + `<th scope="col">За площею, запас ${LAYOUT_CASE_WASTE} %</th></tr></thead><tbody>${body}</tbody></table>`;
}
