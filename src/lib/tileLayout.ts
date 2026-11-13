/**
 * Tile layout of ONE rectangular surface — the engine behind «Розкласти плитку» (iteration-tile-layout).
 *
 * Pure and offline: every figure is computed on the phone from what the master typed, nothing is asked
 * of the server. The rules are the ones the owner ruled on 2026-11-12, and each is load-bearing:
 *
 * - The count is a RANGE. `maxTiles` buys a fresh tile for every cut piece; `minTiles` reuses offcuts
 *   the way a tiler can: a piece keeps a FACTORY edge wherever it meets another tile and may show a
 *   cut edge only against the wall or an opening (the cut edge has a different body colour and chips),
 *   so one tile yields at most one edge strip per end, and a corner piece needs two factory edges.
 *   A tile is turned 180° in its plane, never 90° (the pattern and the tile's own direction).
 * - A strip is NARROW under a third of the tile or under 50 mm; AUTO searches the start for the widest
 *   narrowest strip, then the fewest tiles.
 * - No allowance is applied here: the spare (5 %, at least 2 tiles) is added once per POSITION by
 *   {@link spareTiles}, over everything laid out on it.
 *
 * Coordinates are millimetres, x from the surface's LEFT edge, y from its BOTTOM (the floor, on a wall).
 * The tile is given AS LAID: `w` along a row, `h` up the wall — a landscape 300×600 is `{ w: 600, h: 300 }`.
 */

export type LayoutPattern = 'STRAIGHT' | 'OFFSET_1_2' | 'OFFSET_1_3' | 'OFFSET_1_4';
/** CORNER = from the left (or the floor); CENTER = a tile on the axis; SYMMETRIC = equal cuts both sides. */
/** MANUAL = where the master dragged the grid to (`manualOrigin`). */
export type LayoutStart = 'CORNER' | 'CENTER' | 'SYMMETRIC' | 'AUTO' | 'MANUAL';
export type Side = 'L' | 'R' | 'B' | 'T';

export interface Opening {
  /** From the surface's left edge to the opening's left edge. */
  x: number;
  /** From the floor to the opening's bottom — 0 for a door. */
  y: number;
  w: number;
  h: number;
}

export interface SurfaceInput {
  width: number;
  height: number;
  tile: { w: number; h: number };
  joint: number;
  /** Gap left against the walls, floor and ceiling (under sealant). */
  edgeGap: number;
  pattern: LayoutPattern;
  hStart: LayoutStart;
  vStart: LayoutStart;
  openings?: Opening[];
  /**
   * The grid's origin when a start is MANUAL — where the master dragged it: the left edge of a tile in
   * the first row, and the bottom edge of a row, mm from the surface's left and bottom. Any value works;
   * it is taken modulo one step.
   */
  manualOrigin?: { x: number; y: number };
}

type Edges = Record<Side, boolean>;

export interface Piece {
  x: number;
  y: number;
  w: number;
  h: number;
  /** FULL = a whole tile; CUT = a rectangle cut from one; SHAPED = cut around an opening (an L or a U). */
  kind: 'FULL' | 'CUT' | 'SHAPED';
  /** True where the side is the tile's own factory edge; false where it was cut. */
  factory: Edges;
  /** Area actually tiled, mm² (a SHAPED piece is less than its bounding box). */
  area: number;
}

export interface EdgeStrip {
  side: Side;
  /** The narrowest cut piece against that side, mm. */
  min: number;
  narrow: boolean;
}

export type LayoutHint = 'NARROW_UNAVOIDABLE' | 'MOSTLY_CUT' | 'TILE_BIGGER_THAN_SURFACE' | 'OFFSET_HALF_LONG';

export interface SurfaceLayout {
  pieces: Piece[];
  full: number;
  cut: number;
  shaped: number;
  /** Every cut piece from its own tile. */
  maxTiles: number;
  /** Offcuts reused under the factory-edge rule. */
  minTiles: number;
  edges: EdgeStrip[];
  hints: LayoutHint[];
  /** Area actually tiled, m². */
  laidArea: number;
  /** Where row 0's first tile starts and the first row starts — what AUTO / SYMMETRIC resolved to. */
  origin: { x: number; y: number };
}

export type LayoutErrorCode = 'SURFACE' | 'TILE' | 'JOINT' | 'GAP' | 'OPENING';

/** A value the master typed that no layout can be drawn from; `code` picks the sentence to show. */
export class TileLayoutError extends Error {
  readonly code: LayoutErrorCode;

  constructor(code: LayoutErrorCode) {
    super(`tile layout: invalid ${code}`);
    this.code = code;
  }
}

export const KERF_MM = 2;
/** An offcut narrower than this in either direction goes to the bin. */
export const MIN_OFFCUT_MM = 40;
export const NARROW_ABSOLUTE_MM = 50;
/** ANSI A108.02 4.3.8.2: over 15″ on the offset side, a running bond offsets at most a third. */
export const OFFSET_HALF_LIMIT_MM = 380;
const AUTO_STEP_MM = 5;
const EPS = 0.5;

const LIMITS = {
  surface: [50, 20_000],
  tile: [20, 3_600],
  joint: [0, 20],
  gap: [0, 50],
} as const;

const SHIFT: Record<LayoutPattern, number> = {
  STRAIGHT: 0,
  OFFSET_1_2: 1 / 2,
  OFFSET_1_3: 1 / 3,
  OFFSET_1_4: 1 / 4,
};

const inRange = (v: number, [lo, hi]: readonly [number, number]) => Number.isFinite(v) && v >= lo && v <= hi;

function validate(s: SurfaceInput): void {
  if (!inRange(s.width, LIMITS.surface) || !inRange(s.height, LIMITS.surface)) throw new TileLayoutError('SURFACE');
  if (!inRange(s.tile.w, LIMITS.tile) || !inRange(s.tile.h, LIMITS.tile)) throw new TileLayoutError('TILE');
  if (!inRange(s.joint, LIMITS.joint) || s.joint >= Math.min(s.tile.w, s.tile.h)) throw new TileLayoutError('JOINT');
  if (!inRange(s.edgeGap, LIMITS.gap) || 2 * s.edgeGap >= Math.min(s.width, s.height)) throw new TileLayoutError('GAP');
  const openings = s.openings ?? [];
  openings.forEach((o, i) => {
    const ok = [o.x, o.y, o.w, o.h].every(Number.isFinite) && o.w > 0 && o.h > 0 && o.x >= 0 && o.y >= 0
      && o.x + o.w <= s.width + EPS && o.y + o.h <= s.height + EPS;
    // Two openings over one spot would take that area out twice.
    const overlaps = openings.slice(0, i).some((p) => o.x < p.x + p.w - EPS && p.x < o.x + o.w - EPS
      && o.y < p.y + p.h - EPS && p.y < o.y + o.h - EPS);
    if (!ok || overlaps) throw new TileLayoutError('OPENING');
  });
}

/** The usable rectangle: the surface less the gap at every side. */
function frame(s: SurfaceInput) {
  return { L: s.edgeGap, R: s.width - s.edgeGap, B: s.edgeGap, T: s.height - s.edgeGap };
}

/** `v` moved by whole steps into (lo − step, lo] — the first tile start at or before the edge. */
function normalize(v: number, lo: number, step: number): number {
  return v - step * Math.ceil((v - lo) / step - 1e-9);
}

/** One run of tiles between `lo` and `hi`: [start, end] of every piece, with which ends were cut. */
function run(origin: number, lo: number, hi: number, size: number, step: number) {
  const out: { a: number; b: number; cutA: boolean; cutB: boolean; index: number }[] = [];
  const first = normalize(origin, lo, step);
  for (let index = 0, start = first; start < hi - EPS; index++, start = first + index * step) {
    const a = Math.max(start, lo);
    const b = Math.min(start + size, hi);
    if (b - a < EPS) continue;
    out.push({ a, b, cutA: a > start + EPS, cutB: b < start + size - EPS, index });
  }
  return out;
}

/** Positions of a tile with `size` on the axis [lo, hi] for the starts that are not searched. */
function canonical(start: 'CORNER' | 'CENTER' | 'JOINT_ON_AXIS', lo: number, hi: number, size: number, joint: number) {
  const mid = (lo + hi) / 2;
  if (start === 'CORNER') return lo;
  if (start === 'CENTER') return mid - size / 2;
  return mid + joint / 2;
}

function rowShift(pattern: LayoutPattern, row: number, step: number): number {
  const f = (row * SHIFT[pattern]) % 1;
  return f * step;
}

function build(s: SurfaceInput, ox: number, oy: number): Piece[] {
  const f = frame(s);
  const stepX = s.tile.w + s.joint;
  const stepY = s.tile.h + s.joint;
  const pieces: Piece[] = [];
  // Rows count from the lowest one, so the floor row is always the unshifted base row.
  for (const r of run(oy, f.B, f.T, s.tile.h, stepY)) {
    const cols = run(ox + rowShift(s.pattern, r.index, stepX), f.L, f.R, s.tile.w, stepX);
    for (const c of cols) {
      const factory = { L: !c.cutA, R: !c.cutB, B: !r.cutA, T: !r.cutB };
      const whole = factory.L && factory.R && factory.B && factory.T;
      pieces.push({ x: c.a, y: r.a, w: c.b - c.a, h: r.b - r.a, kind: whole ? 'FULL' : 'CUT', factory, area: (c.b - c.a) * (r.b - r.a) });
    }
  }
  return carve(pieces, s.openings ?? []);
}

/**
 * Takes the openings out. A tile wholly inside one is not laid; a tile an opening bites across its
 * whole height (or width) from one side stays a rectangle with that side cut; anything else is SHAPED.
 */
function carve(pieces: Piece[], openings: Opening[]): Piece[] {
  if (openings.length === 0) return pieces;
  const out: Piece[] = [];
  for (const p0 of pieces) {
    let p: Piece | null = { ...p0, factory: { ...p0.factory } };
    for (const o of openings) {
      if (!p) break;
      const ix0 = Math.max(p.x, o.x);
      const ix1 = Math.min(p.x + p.w, o.x + o.w);
      const iy0 = Math.max(p.y, o.y);
      const iy1 = Math.min(p.y + p.h, o.y + o.h);
      if (ix1 - ix0 < EPS || iy1 - iy0 < EPS) continue;
      const coversW = ix0 <= p.x + EPS && ix1 >= p.x + p.w - EPS;
      const coversH = iy0 <= p.y + EPS && iy1 >= p.y + p.h - EPS;
      if (coversW && coversH) {
        p = null;
        continue;
      }
      if (p.kind !== 'SHAPED' && coversH && (ix0 <= p.x + EPS || ix1 >= p.x + p.w - EPS)) {
        if (ix0 <= p.x + EPS) {
          p.w = p.x + p.w - ix1;
          p.x = ix1;
          p.factory.L = false;
        } else {
          p.w = ix0 - p.x;
          p.factory.R = false;
        }
        p.kind = 'CUT';
        p.area = p.w * p.h;
      } else if (p.kind !== 'SHAPED' && coversW && (iy0 <= p.y + EPS || iy1 >= p.y + p.h - EPS)) {
        if (iy0 <= p.y + EPS) {
          p.h = p.y + p.h - iy1;
          p.y = iy1;
          p.factory.B = false;
        } else {
          p.h = iy0 - p.y;
          p.factory.T = false;
        }
        p.kind = 'CUT';
        p.area = p.w * p.h;
      } else {
        p.kind = 'SHAPED';
        p.area -= (ix1 - ix0) * (iy1 - iy0);
      }
    }
    if (p && p.area > EPS) out.push(p);
  }
  return out;
}

/** The narrowest cut piece against each side of the frame — the strips the master will see. */
function edgeStrips(s: SurfaceInput, pieces: Piece[]): EdgeStrip[] {
  const f = frame(s);
  const mins: Partial<Record<Side, number>> = {};
  const take = (side: Side, v: number) => {
    mins[side] = Math.min(mins[side] ?? Infinity, v);
  };
  for (const p of pieces) {
    if (p.kind === 'FULL') continue;
    const bothX = !p.factory.L && !p.factory.R && p.x <= f.L + EPS && p.x + p.w >= f.R - EPS;
    const bothY = !p.factory.B && !p.factory.T && p.y <= f.B + EPS && p.y + p.h >= f.T - EPS;
    if (!bothX) {
      if (!p.factory.L && p.x <= f.L + EPS) take('L', p.w);
      if (!p.factory.R && p.x + p.w >= f.R - EPS) take('R', p.w);
    }
    if (!bothY) {
      if (!p.factory.B && p.y <= f.B + EPS) take('B', p.h);
      if (!p.factory.T && p.y + p.h >= f.T - EPS) take('T', p.h);
    }
  }
  return (['L', 'R', 'B', 'T'] as const)
    .filter((side) => mins[side] !== undefined)
    .map((side) => {
      const min = mins[side] ?? 0;
      const along = side === 'L' || side === 'R' ? s.tile.w : s.tile.h;
      return { side, min: round1(min), narrow: isNarrow(min, along) };
    });
}

export function isNarrow(piece: number, tileSide: number): boolean {
  return piece < tileSide / 3 || piece < NARROW_ABSOLUTE_MM;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** The narrowest strip on the sides one axis moves, Infinity when there is none. */
function narrowest(s: SurfaceInput, pieces: Piece[], axis: 'x' | 'y'): number {
  const sides: Side[] = axis === 'x' ? ['L', 'R'] : ['B', 'T'];
  const strips = edgeStrips(s, pieces).filter((e) => sides.includes(e.side));
  return strips.length === 0 ? Infinity : Math.min(...strips.map((e) => e.min));
}

/** Resolves one axis's start to an origin, the other axis's origin held fixed. */
function resolveAxis(s: SurfaceInput, axis: 'x' | 'y', start: LayoutStart, other: number): number {
  const f = frame(s);
  const [lo, hi, size] = axis === 'x' ? [f.L, f.R, s.tile.w] : [f.B, f.T, s.tile.h];
  const at = (o: number) => (axis === 'x' ? build(s, o, other) : build(s, other, o));
  if (start === 'MANUAL') {
    const o = axis === 'x' ? s.manualOrigin?.x : s.manualOrigin?.y;
    return o != null && Number.isFinite(o) ? o : lo;
  }
  if (start === 'CORNER' || start === 'CENTER') return canonical(start, lo, hi, size, s.joint);
  const tileOnAxis = canonical('CENTER', lo, hi, size, s.joint);
  const jointOnAxis = canonical('JOINT_ON_AXIS', lo, hi, size, s.joint);
  if (start === 'SYMMETRIC') {
    return narrowest(s, at(jointOnAxis), axis) >= narrowest(s, at(tileOnAxis), axis) ? jointOnAxis : tileOnAxis;
  }
  // AUTO: the widest narrowest strip up to «not narrow», then the fewest pieces, then the widest strip.
  const target = Math.max(size / 3, NARROW_ABSOLUTE_MM);
  const step = size + s.joint;
  const candidates = [lo, tileOnAxis, jointOnAxis];
  for (let o = lo - step + AUTO_STEP_MM; o < lo; o += AUTO_STEP_MM) candidates.push(o);
  let best = lo;
  let bestScore: [number, number, number] | null = null;
  for (const o of candidates) {
    const pieces = at(o);
    const min = narrowest(s, pieces, axis);
    const score: [number, number, number] = [Math.min(min, target), -pieces.length, Math.min(min, 1e9)];
    if (!bestScore || better(score, bestScore)) {
      best = o;
      bestScore = score;
    }
  }
  return best;
}

function better(a: [number, number, number], b: [number, number, number]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > 1e-6) return a[i] > b[i];
  }
  return false;
}

/** Both origins for the starts asked; AUTO on both axes settles y, then x, then y again. */
function origins(s: SurfaceInput): { x: number; y: number } {
  const f = frame(s);
  let y = s.vStart === 'AUTO' ? f.B : resolveAxis(s, 'y', s.vStart, f.L);
  let x = resolveAxis(s, 'x', s.hStart, y);
  if (s.vStart === 'AUTO') {
    const settled = resolveAxis(s, 'y', 'AUTO', x);
    // The rows moved, so the row ends did too — search x once more; unmoved, x already fits them.
    if (Math.abs(settled - y) > EPS) {
      y = settled;
      x = resolveAxis(s, 'x', s.hStart, y);
    }
  }
  return { x, y };
}

export function layoutSurface(s: SurfaceInput): SurfaceLayout {
  validate(s);
  const origin = origins(s);
  const pieces = build(s, origin.x, origin.y);
  const full = pieces.filter((p) => p.kind === 'FULL').length;
  const cut = pieces.filter((p) => p.kind === 'CUT').length;
  const shaped = pieces.filter((p) => p.kind === 'SHAPED').length;
  const edges = edgeStrips(s, pieces);
  return {
    pieces,
    full,
    cut,
    shaped,
    maxTiles: full + cut + shaped,
    minTiles: full + shaped + tilesForCuts(pieces, s.tile),
    edges,
    hints: hints(s, pieces, edges, full, cut + shaped),
    laidArea: pieces.reduce((a, p) => a + p.area, 0) / 1e6,
    origin,
  };
}

function hints(s: SurfaceInput, pieces: Piece[], edges: EdgeStrip[], full: number, cuts: number): LayoutHint[] {
  const out: LayoutHint[] = [];
  const f = frame(s);
  if (s.tile.w > f.R - f.L + EPS || s.tile.h > f.T - f.B + EPS) out.push('TILE_BIGGER_THAN_SURFACE');
  if (edges.some((e) => e.narrow) && !out.includes('TILE_BIGGER_THAN_SURFACE')) {
    // Unavoidable only if the best start the engine can find still leaves one — which, when both
    // starts already ARE that search, is the layout in hand.
    const searched = s.hStart === 'AUTO' && s.vStart === 'AUTO';
    const auto = { ...s, hStart: 'AUTO' as const, vStart: 'AUTO' as const };
    const o = searched ? null : origins(auto);
    if (!o || edgeStrips(auto, build(auto, o.x, o.y)).some((e) => e.narrow)) out.push('NARROW_UNAVOIDABLE');
  }
  if (cuts > full && pieces.length >= 4) out.push('MOSTLY_CUT');
  if (s.pattern === 'OFFSET_1_2' && s.tile.w > OFFSET_HALF_LIMIT_MM) out.push('OFFSET_HALF_LONG');
  return out;
}

// ---- offcut reuse ---------------------------------------------------------------------------------

interface Stock {
  w: number;
  h: number;
  factory: Edges;
}

const turned = (e: Edges): Edges => ({ L: e.R, R: e.L, B: e.T, T: e.B });

/**
 * The tiles the CUT pieces need when offcuts are reused — biggest piece first, each from the smallest
 * offcut it fits, else a fresh tile. A piece must keep a factory edge wherever it meets another tile;
 * a cut leaves at most two offcuts (the rest of the width at full height, then the rest of the height),
 * and one narrower than {@link MIN_OFFCUT_MM} is thrown away.
 */
export function tilesForCuts(pieces: Piece[], tile: { w: number; h: number }): number {
  const demands = pieces
    .filter((p) => p.kind === 'CUT')
    .map((p) => ({ w: p.w, h: p.h, need: p.factory }))
    .sort((a, b) => b.w * b.h - a.w * a.h);
  const pool: Stock[] = [];
  let tiles = 0;
  for (const d of demands) {
    let bestIdx = -1;
    let bestCut: Stock[] = [];
    for (let i = 0; i < pool.length; i++) {
      const st = pool[i];
      if (bestIdx >= 0 && st.w * st.h >= pool[bestIdx].w * pool[bestIdx].h) continue;
      const leftovers = cutFrom(st, d);
      if (leftovers) {
        bestIdx = i;
        bestCut = leftovers;
      }
    }
    if (bestIdx >= 0) {
      pool.splice(bestIdx, 1, ...bestCut);
    } else {
      tiles++;
      const fresh: Stock = { w: tile.w, h: tile.h, factory: { L: true, R: true, B: true, T: true } };
      pool.push(...(cutFrom(fresh, d) ?? []));
    }
  }
  return tiles;
}

/**
 * The offcuts left after cutting `d` from `st` (turned 0° or 180°, from any corner) so that every side
 * `d` needs factory IS factory — or null when it cannot be cut from it.
 */
function cutFrom(st: Stock, d: { w: number; h: number; need: Edges }): Stock[] | null {
  const fullW = Math.abs(st.w - d.w) < EPS;
  const fullH = Math.abs(st.h - d.h) < EPS;
  if (d.w > st.w + EPS || d.h > st.h + EPS) return null;
  if (!fullW && st.w - d.w < KERF_MM) return null;
  if (!fullH && st.h - d.h < KERF_MM) return null;
  for (const f of [st.factory, turned(st.factory)]) {
    for (const left of [true, false]) {
      for (const bottom of [true, false]) {
        const got: Edges = {
          L: left || fullW ? f.L : false,
          R: !left || fullW ? f.R : false,
          B: bottom || fullH ? f.B : false,
          T: !bottom || fullH ? f.T : false,
        };
        if ((d.need.L && !got.L) || (d.need.R && !got.R) || (d.need.B && !got.B) || (d.need.T && !got.T)) continue;
        const out: Stock[] = [];
        if (!fullW) {
          // The rest of the width, full height: its side against the cut is cut.
          out.push({
            w: st.w - d.w - KERF_MM,
            h: st.h,
            factory: left ? { L: false, R: f.R, B: f.B, T: f.T } : { L: f.L, R: false, B: f.B, T: f.T },
          });
        }
        if (!fullH) {
          out.push({
            w: d.w,
            h: st.h - d.h - KERF_MM,
            factory: {
              L: left || fullW ? f.L : false,
              R: !left || fullW ? f.R : false,
              B: bottom ? false : f.B,
              T: bottom ? f.T : false,
            },
          });
        }
        return out.filter((o) => o.w >= MIN_OFFCUT_MM && o.h >= MIN_OFFCUT_MM);
      }
    }
  }
  return null;
}

// ---- a position: several surfaces of one tile -------------------------------------------------

/** 5 % of what is bought, at least two tiles: breakage, and a tile for a repair from the same batch. */
export function spareTiles(maxTiles: number): number {
  if (maxTiles <= 0) return 0;
  return Math.max(2, Math.ceil(maxTiles * 0.05 - 1e-9));
}

export interface PositionCount {
  minTiles: number;
  maxTiles: number;
  spare: number;
  laidArea: number;
}

/** The surfaces of one position together: offcuts travel between walls, the spare is added once. */
export function countPosition(layouts: SurfaceLayout[], tile: { w: number; h: number }): PositionCount {
  const pieces = layouts.flatMap((l) => l.pieces);
  const fixed = layouts.reduce((a, l) => a + l.full + l.shaped, 0);
  const maxTiles = layouts.reduce((a, l) => a + l.maxTiles, 0);
  return {
    minTiles: fixed + tilesForCuts(pieces, tile),
    maxTiles,
    spare: spareTiles(maxTiles),
    laidArea: layouts.reduce((a, l) => a + l.laidArea, 0),
  };
}

/** What «за площею» buys for the same area, for the comparison line: area × (1 + waste) in tiles, up. */
export function tilesByArea(areaM2: number, tile: { w: number; h: number }, wastePercent: number): number {
  const perTile = (tile.w * tile.h) / 1e6;
  return Math.ceil((areaM2 * (1 + wastePercent / 100)) / perTile - 1e-9);
}
