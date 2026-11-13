import {
  countPosition,
  layoutSurface,
  TileLayoutError,
  tilesByArea,
  type LayoutHint,
  type LayoutPattern,
  type LayoutStart,
  type Opening,
  type SurfaceLayout,
} from '@/lib/tileLayout.ts';
import type {
  EstimateItemResponse, MeasurementItem, MeasurementItemRequest, SurfacePayload, TileLayoutRequest, TileLayoutView,
} from '@/api/types.ts';
import { parseDecimal } from '@/lib/parseDecimal.ts';

/**
 * The layout screen's model (iteration-tile-layout, stage 3): what the master typed, kept as plain
 * data, and everything the screen shows derived from it by the engine. No React here, so every rule
 * the screen depends on is unit-tested.
 */

/** The layout screen's own address — a line of an estimate. */
export const tileLayoutRoute = (estimateId: string, itemId: string) =>
  `/estimates/${estimateId}/items/${itemId}/tile-layout`;

/** The library's formats (V171), short side first — the quick picks. */
export const STANDARD_FORMATS: [number, number][] = [
  [100, 100], [200, 200], [300, 300], [300, 600], [300, 900], [600, 600], [600, 1200], [800, 800],
  [800, 1600], [1000, 1000], [1000, 2000], [1000, 3000], [1200, 1200], [1200, 2400], [1200, 3200],
  [1500, 3000], [1600, 1600], [1600, 3200],
];

export type Orientation = 'LANDSCAPE' | 'PORTRAIT';

export interface SurfaceDraft {
  key: string;
  name: string;
  enabled: boolean;
  /** Millimetres. */
  width: number;
  height: number;
  pattern: LayoutPattern;
  start: LayoutStart;
  openings: Opening[];
  /** A floor lays its first row from the middle; a wall from the floor. */
  floor: boolean;
  /** Where the master dragged the grid (start MANUAL): the engine's `manualOrigin`, mm. */
  origin?: { x: number; y: number };
}

export interface LayoutDraft {
  version: 1;
  format: { short: number; long: number };
  orientation: Orientation;
  joint: number;
  surfaces: SurfaceDraft[];
  /** Openings read off the measurements that are not on a wall yet (they carry no position). */
  unplaced: { w: number; h: number }[];
  /** The surfaces came from the object's measurements — nothing to offer saving back. */
  fromMeasurements?: boolean;
  /** The master already saved these sizes into the measurements — never offered twice. */
  savedToMeasurements?: boolean;
}

export const DEFAULT_JOINT = 2;

/** The tile as laid: `w` along a row. Landscape lays the long side along the row. */
export function laidTile(d: Pick<LayoutDraft, 'format' | 'orientation'>): { w: number; h: number } {
  return d.orientation === 'LANDSCAPE'
    ? { w: d.format.long, h: d.format.short }
    : { w: d.format.short, h: d.format.long };
}

/** «Укладання плитки 300х600», «30x60», «600 × 1200» — short side first, mm (cm read as cm × 10). */
export function formatFromName(name: string): { short: number; long: number } | null {
  const m = /(\d{2,4})\s*[xXхХ×*]\s*(\d{2,4})/.exec(name);
  if (!m) return null;
  let a = Number(m[1]);
  let b = Number(m[2]);
  if (a < 100 && b < 100) {
    a *= 10;
    b *= 10;
  }
  return { short: Math.min(a, b), long: Math.max(a, b) };
}

/** Is this line one a tile layout can describe — m² work that names tile, or a tiling line. */
export function isTilingLine(item: Pick<EstimateItemResponse, 'type' | 'unit' | 'name' | 'trade'>): boolean {
  if (item.type !== 'WORK' || item.unit !== 'M2') return false;
  return item.trade === 'TILING' || /плитк|керамограніт|кахл|мозаїк/i.test(item.name);
}

let seq = 0;
export const newKey = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * A size the master TYPES — of a wall, a floor, a room or an opening — is in METRES, as a tape reads:
 * «3,6». A number above {@link METRES_UP_TO} cannot be metres here (a surface is at most 20 m), so it
 * is read as millimetres — «3600» is 3,6 m — and the field says how it was read. The engine keeps mm.
 */
export const METRES_UP_TO = 20;

export function sizeToMm(raw: string): number {
  const v = parseDecimal(raw.trim());
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.round(v <= METRES_UP_TO ? v * 1000 : v);
}

/** Whether a typed size was read as millimetres rather than metres — the field then echoes it. */
export function readAsMm(raw: string): boolean {
  return sizeToMm(raw) > 0 && parseDecimal(raw.trim()) > METRES_UP_TO;
}

const metres = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 3, useGrouping: false });

/** Millimetres shown as the metres a field holds: 3600 → «3,6», 0 → empty. */
export function mmToMetres(mm: number): string {
  return mm > 0 ? metres.format(mm / 1000) : '';
}

/** The surface a tiling line names: «…на підлогу», «…підлоги», «стяжка» are a floor; anything else a wall. */
export function lineIsFloor(name: string): boolean {
  return /підлог|сходин|сходи|терас|балкон/i.test(name) && !/стін|фартух|фасад/i.test(name);
}

export function wall(name: string, width = 0, height = 0): SurfaceDraft {
  return { key: newKey(), name, enabled: true, width, height, pattern: 'STRAIGHT', start: 'SYMMETRIC', openings: [], floor: false };
}

export function floor(name: string, width = 0, depth = 0): SurfaceDraft {
  return { ...wall(name, width, depth), floor: true };
}

/**
 * A room as length × width × height: four walls and the floor. Which of them the line covers is a
 * guess the master corrects with one tap — the floor alone when the line's m² is near the floor's,
 * else the walls.
 */
export function roomSurfaces(lengthMm: number, widthMm: number, heightMm: number, lineM2: number,
  names: { wall: (letter: string) => string; floor: string }, floorLine?: boolean): SurfaceDraft[] {
  const walls = [
    wall(names.wall('А'), lengthMm, heightMm),
    wall(names.wall('Б'), widthMm, heightMm),
    wall(names.wall('В'), lengthMm, heightMm),
    wall(names.wall('Г'), widthMm, heightMm),
  ];
  const fl = floor(names.floor, lengthMm, widthMm);
  const floorM2 = (lengthMm * widthMm) / 1e6;
  // The line's own words decide first («на підлогу»); else its m² near the floor's.
  const floorOnly = floorLine ?? (lineM2 > 0 && Math.abs(lineM2 - floorM2) <= floorM2 * 0.15);
  walls.forEach((w) => { w.enabled = !floorOnly; });
  fl.enabled = floorOnly;
  return [...walls, fl];
}

const FACTOR = { MM: 1, CM: 10, M: 1000 } as const;

/**
 * The surfaces a line's measurements describe. A rectangular plane becomes a surface; any other shape
 * stays out (it is bought by area). Openings carry no position in the measurements, so they come back
 * UNPLACED for the master to put on a wall.
 */
export function surfacesFromMeasurements(items: MeasurementItem[], refs: string[]): {
  surfaces: SurfaceDraft[]; unplaced: { w: number; h: number }[]; skipped: number;
} {
  const surfaces: SurfaceDraft[] = [];
  const unplaced: { w: number; h: number }[] = [];
  let skipped = 0;
  for (const item of items) {
    if (!refs.includes(item.id) || item.type !== 'SURFACE') continue;
    const p = item.payload as SurfacePayload;
    const f = FACTOR[p.unit ?? 'M'];
    const isFloor = /підлог|пол\b/i.test(item.name);
    p.segments.forEach((seg, i) => {
      const values = seg.values ?? {};
      const a = seg.shape === 'rect' ? values.a : seg.shape == null ? seg.l : undefined;
      const b = seg.shape === 'rect' ? values.b : seg.shape == null ? seg.w : undefined;
      if (!a || !b) {
        skipped++;
        return;
      }
      const name = p.segments.length > 1 ? `${item.name} · ${i + 1}` : item.name;
      surfaces.push(isFloor ? floor(name, a * f, b * f) : wall(name, a * f, b * f));
    });
    for (const o of p.openings) {
      for (let n = 0; n < Math.max(1, o.n); n++) unplaced.push({ w: o.w * f, h: o.h * f });
    }
  }
  return { surfaces, unplaced, skipped };
}

export interface SurfaceResult {
  key: string;
  layout: SurfaceLayout | null;
  error: TileLayoutError['code'] | null;
  /** The MOSTLY_CUT hint is about the format only when the corner start does not cut less. */
  cornerCutsLess: boolean;
}

export interface DraftResult {
  surfaces: SurfaceResult[];
  laidArea: number;
  minTiles: number;
  maxTiles: number;
  spare: number;
  /** What «за площею» would buy for the area laid out, at the master's allowance. */
  byArea: number;
  /** The line's m² the layout does not cover — still bought by area. */
  rest: number;
  /** The surfaces add up to more than the line by over 5 %. */
  overLine: boolean;
}

export function inputOf(d: LayoutDraft, s: SurfaceDraft) {
  return {
    width: s.width,
    height: s.height,
    tile: laidTile(d),
    joint: d.joint,
    edgeGap: d.joint,
    pattern: s.pattern,
    hStart: s.start,
    // A wall starts its rows on the floor — unless the master moved the whole grid himself.
    vStart: s.floor || s.start === 'MANUAL' ? s.start : ('CORNER' as LayoutStart),
    openings: s.openings,
    ...(s.start === 'MANUAL' && s.origin ? { manualOrigin: s.origin } : {}),
  };
}

export function evaluate(d: LayoutDraft, lineM2: number, wastePercent = 10): DraftResult {
  const surfaces: SurfaceResult[] = d.surfaces.map((s) => {
    if (!s.enabled) return { key: s.key, layout: null, error: null, cornerCutsLess: false };
    try {
      const layout = layoutSurface(inputOf(d, s));
      let cornerCutsLess = false;
      if (layout.hints.includes('MOSTLY_CUT') && s.start !== 'CORNER') {
        cornerCutsLess = layoutSurface({ ...inputOf(d, s), hStart: 'CORNER' }).cut < layout.cut;
      }
      return { key: s.key, layout, error: null, cornerCutsLess };
    } catch (e) {
      if (e instanceof TileLayoutError) return { key: s.key, layout: null, error: e.code, cornerCutsLess: false };
      throw e;
    }
  });
  const laid = surfaces.flatMap((r) => (r.layout ? [r.layout] : []));
  const count = countPosition(laid, laidTile(d));
  // The area as a master MEASURES it — the walls less the openings, joints included — because that is
  // what the estimate line's m² and every by-area figure are written in. The tiles' own face area
  // (count.laidArea) is smaller by the joints and would leave a «rest» that is only grout.
  const laidArea = round3(d.surfaces.reduce((a, s) => {
    const ok = surfaces.find((r) => r.key === s.key)?.layout;
    if (!ok) return a;
    const openings = s.openings.reduce((o, x) => o + x.w * x.h, 0);
    return a + Math.max(0, s.width * s.height - openings) / 1e6;
  }, 0));
  return {
    surfaces,
    laidArea,
    minTiles: count.minTiles,
    maxTiles: count.maxTiles,
    spare: count.spare,
    byArea: laidArea > 0 ? tilesByArea(laidArea, laidTile(d), wastePercent) : 0,
    rest: Math.max(0, round3(lineM2 - laidArea)),
    overLine: lineM2 > 0 && laidArea > lineM2 * 1.05,
  };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

export function toRequest(d: LayoutDraft, r: DraftResult, measurementsDeclined?: boolean): TileLayoutRequest {
  return {
    tileWidthMm: d.format.short,
    tileHeightMm: d.format.long,
    laidArea: r.laidArea,
    minTiles: r.minTiles,
    maxTiles: r.maxTiles,
    spare: r.spare,
    params: JSON.stringify(d),
    ...(measurementsDeclined === undefined ? {} : { measurementsDeclined }),
  };
}

/** A stored layout's draft back — null when it was written by a shape this build cannot read. */
export function fromStored(view: TileLayoutView): LayoutDraft | null {
  try {
    const d = JSON.parse(view.params) as Partial<LayoutDraft>;
    if (d.version !== 1 || !d.format || !Array.isArray(d.surfaces)) return null;
    return {
      version: 1,
      format: d.format,
      orientation: d.orientation === 'PORTRAIT' ? 'PORTRAIT' : 'LANDSCAPE',
      joint: typeof d.joint === 'number' ? d.joint : DEFAULT_JOINT,
      surfaces: d.surfaces.map((s) => ({ ...s, key: s.key || newKey(), openings: s.openings ?? [] })),
      unplaced: d.unplaced ?? [],
      ...(d.fromMeasurements ? { fromMeasurements: true } : {}),
      ...(d.savedToMeasurements ? { savedToMeasurements: true } : {}),
    };
  } catch {
    return null;
  }
}

/** Can the draft be saved — a format, and at least one surface laid out without an error. */
export function canSave(r: DraftResult): boolean {
  return r.laidArea > 0 && r.maxTiles > 0 && r.surfaces.every((s) => s.error === null);
}

export type { LayoutHint };

/**
 * Stage 4: offer to keep the sizes in the object's measurements — only for sizes the master typed here,
 * only once per line (a «ні» is stored as `measurementsDeclined`, a «так» as `savedToMeasurements`).
 */
export function shouldOfferMeasurements(d: LayoutDraft, declined: boolean): boolean {
  return !declined && !d.fromMeasurements && !d.savedToMeasurements
    && d.surfaces.some((s) => s.enabled && s.width > 0 && s.height > 0);
}

/**
 * The laid surfaces as measurement elements, in millimetres — ONE element per surface, under the name the
 * master gave it («Фартух», «Стіна А»), its own openings with it. A blank name takes the kind's default.
 */
export function measurementItems(d: LayoutDraft, names: { walls: string; floor: string }): MeasurementItemRequest[] {
  return d.surfaces
    .filter((s) => s.enabled && s.width > 0 && s.height > 0)
    .map((s, order) => ({
      name: s.name.trim() || (s.floor ? names.floor : names.walls),
      type: 'SURFACE',
      sortOrder: order,
      payload: {
        unit: 'MM',
        segments: [{ shape: 'rect', mode: 'd', values: { a: s.width, b: s.height } }],
        openings: s.openings.filter((o) => o.w > 0 && o.h > 0).map((o) => ({ w: o.w, h: o.h, n: 1 })),
      },
    }));
}

/** Moving a dragged opening keeps it on the surface and on a 5 mm step. */
export function clampOpening(s: SurfaceDraft, o: { x: number; y: number; w: number; h: number }) {
  const step = (v: number) => Math.round(v / 5) * 5;
  return {
    ...o,
    x: Math.min(Math.max(0, step(o.x)), Math.max(0, s.width - o.w)),
    y: Math.min(Math.max(0, step(o.y)), Math.max(0, s.height - o.h)),
  };
}
