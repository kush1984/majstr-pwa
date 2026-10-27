import type { Built, Pt } from './shapes.ts';

/**
 * Where everything in a shape drawing goes: the polygon scaled to fit the box, the letter of each
 * measured side outside its midpoint, the vertex names, and the dashed height. Pure, so the app's
 * `ShapeDiagram` and the static wall-area page (src/seo/) draw the same picture.
 *
 * Before anything is typed the `outline` (reference proportions) is laid out instead of an empty
 * box, so the letters teach from the first render; `dimmed` says so.
 */
export interface DiagramLayout {
  drawn: Built;
  dimmed: boolean;
  /** The polygon, in SVG coordinates. */
  points: Pt[];
  edgeLabels: { tag: string; p: Pt }[];
  vertexLabels: { name: string; p: Pt }[];
  height: { apex: Pt; foot: Pt; tag: string } | null;
}

export const DIAGRAM_W = 340;
export const DIAGRAM_H = 250;

export function layoutDiagram(built: Built, outline: Built): DiagramLayout {
  const drawn = built.ok ? built : outline;
  const W = DIAGRAM_W;
  const H = DIAGRAM_H;
  const pad = 44;

  const xs = drawn.pts.map((p) => p[0]);
  const ys = drawn.pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rX = maxX - minX || 1;
  const rY = maxY - minY || 1;
  const s = Math.min((W - 2 * pad) / rX, (H - 2 * pad) / rY);
  const offX = (W - rX * s) / 2;
  const offY = (H - rY * s) / 2;
  // y grows upward in the model, downward in SVG.
  const tx = (p: Pt): Pt => [(p[0] - minX) * s + offX, H - ((p[1] - minY) * s + offY)];

  const T = drawn.pts.map(tx);
  const cx = T.reduce((a, p) => a + p[0], 0) / T.length;
  const cy = T.reduce((a, p) => a + p[1], 0) / T.length;
  /** Push a point away from the centroid so labels sit outside the figure. */
  const out = (p: Pt, dist: number): Pt => {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const len = Math.hypot(dx, dy) || 1;
    return [p[0] + (dx / len) * dist, p[1] + (dy / len) * dist];
  };

  /** Distance from a point to a segment — a label this close to a side would sit on its line. */
  const segDist = (p: Pt, a: Pt, b: Pt): number => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };

  /** Even-odd ray cast: is this SVG point inside the drawn polygon? */
  const inside = ([x, y]: Pt): boolean => {
    let hit = false;
    for (let i = 0, j = T.length - 1; i < T.length; j = i++) {
      const [xi, yi] = T[i];
      const [xj, yj] = T[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };

  // A side's letter sits on that side's OUTWARD NORMAL. Pushed from the centroid instead, the
  // letter of a short inner side (an L-room's step) landed on the vertex names beside it.
  const edgeLabels = drawn.edges.map((e) => {
    const a = T[e.i];
    const b = T[e.j];
    const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let n: Pt = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
    if (inside([mid[0] + n[0] * 3, mid[1] + n[1] * 3])) n = [-n[0], -n[1]];
    const d = 18;
    const u: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    return { tag: e.tag, len, u, p: [mid[0] + n[0] * d, mid[1] + n[1] * d] as Pt };
  });
  // Two letters still meet where two short sides meet (a narrow L step). The LONGER side's letter
  // slides along its own line — it has room to and stays beside the side it names.
  const MIN_GAP = 22;
  for (const x of edgeLabels) {
    for (const y of edgeLabels) {
      if (x === y || x.len < y.len) continue;
      const gap = Math.hypot(x.p[0] - y.p[0], x.p[1] - y.p[1]);
      if (gap >= MIN_GAP) continue;
      const away = (x.p[0] - y.p[0]) * x.u[0] + (x.p[1] - y.p[1]) * x.u[1] >= 0 ? 1 : -1;
      const shift = Math.min(MIN_GAP - gap + 4, x.len / 2 - 8);
      x.p = [x.p[0] + x.u[0] * away * shift, x.p[1] + x.u[1] * away * shift];
    }
  }
  const vertexLabels = T.map((p, k) => ({ name: drawn.vnames[k], p: out(p, 15) }))
    // A vertex name is a reference mark; a side's letter is what the master reads. On a cramped
    // corner the name gives way.
    .filter((v) => edgeLabels.every((e) => Math.hypot(e.p[0] - v.p[0], e.p[1] - v.p[1]) > 16))
    .filter((v) => T.every((a, i) => segDist(v.p, a, T[(i + 1) % T.length]) > 7));

  return {
    drawn,
    dimmed: !built.ok,
    points: T,
    edgeLabels: edgeLabels.map(({ tag, p }) => ({ tag, p })),
    vertexLabels,
    height: drawn.height
      ? { apex: tx(drawn.height.apex), foot: tx(drawn.height.foot), tag: drawn.height.tag }
      : null,
  };
}
