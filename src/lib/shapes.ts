/**
 * Surface-shape geometry — shared by the single-line quantity calculator and the
 * object-measurements SURFACE editor so both draw and count identically.
 *
 * Area is ALWAYS the shoelace formula over built vertices, never a per-shape
 * formula: one code path covers every shape, including the skewed ones. The
 * backend mirrors this file (`Shapes.java`) because the server — not the client —
 * is the source of truth for a measurement result.
 *
 * Labels are i18n keys (`shape.*`); this module stays free of UI and translations.
 */

export type Pt = [number, number];
export type ShapeKey = 'rect' | 'trap' | 'attic' | 'tri' | 'cut';

/** The unit the master types dimensions in; area converts to m² via the factor squared. */
export type LengthUnit = 'MM' | 'CM' | 'M';
export const LENGTH_UNITS: LengthUnit[] = ['MM', 'CM', 'M'];
export const LENGTH_FACTOR: Record<LengthUnit, number> = { MM: 0.001, CM: 0.01, M: 1 };

export type Edge = { tag: string; i: number; j: number };
export type Height = { apex: Pt; foot: Pt; tag: string };

export type Built = {
  pts: Pt[];
  vnames: string[];
  edges: Edge[];
  /** Dashed perpendicular drawn with a right-angle marker (trapezoid/mansard/triangle). */
  height?: Height;
  formulaKey: string;
  ok: boolean;
  warnKey?: string;
  noteKey?: string;
  /** Cut corner only: the slope length, for the master to cross-check with a tape. */
  diag?: number;
  /** Area in the entered unit squared; 0 when the dimensions don't form a figure. */
  area: number;
};

export type ShapeField = {
  key: string;
  /** The letter printed on the diagram — the same letter labels the input. */
  tag: string;
  /** Proportions used to draw the reference outline before anything is typed. */
  def: number;
};

export type ShapeVariant = {
  fields: ShapeField[];
  build: (v: Record<string, number>) => Built;
};

export type ShapeDef = { variants: Record<string, ShapeVariant> };

/** |Σ(xᵢ·yᵢ₊₁ − xᵢ₊₁·yᵢ)| / 2 — area of any simple polygon from its vertices. */
export function shoelace(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

const withArea = (o: Omit<Built, 'area'>): Built => ({ ...o, area: o.ok ? shoelace(o.pts) : 0 });

export const SHAPES: Record<ShapeKey, ShapeDef> = {
  rect: {
    variants: {
      d: {
        fields: [
          { key: 'a', tag: 'a', def: 300 },
          { key: 'b', tag: 'b', def: 250 },
        ],
        build: ({ a, b }) =>
          withArea({
            pts: [[0, 0], [a, 0], [a, b], [0, b]],
            vnames: ['A', 'B', 'C', 'D'],
            edges: [{ tag: 'a', i: 0, j: 1 }, { tag: 'b', i: 1, j: 2 }],
            formulaKey: 'shape.rect.d.formula',
            ok: a > 0 && b > 0,
          }),
      },
    },
  },

  trap: {
    variants: {
      d: {
        fields: [
          { key: 'a', tag: 'a', def: 180 },
          { key: 'b', tag: 'b', def: 300 },
          { key: 'h', tag: 'h', def: 200 },
        ],
        build: ({ a, b, h }) =>
          withArea({
            pts: [[0, 0], [b, 0], [(b + a) / 2, h], [(b - a) / 2, h]],
            vnames: ['A', 'B', 'C', 'D'],
            edges: [{ tag: 'b', i: 0, j: 1 }, { tag: 'a', i: 3, j: 2 }],
            height: { apex: [(b - a) / 2, h], foot: [(b - a) / 2, 0], tag: 'h' },
            formulaKey: 'shape.trap.d.formula',
            ok: a > 0 && b > 0 && h > 0,
            noteKey: a > 0 && a === b ? 'shape.note.trapIsRect' : undefined,
          }),
      },
    },
  },

  attic: {
    variants: {
      sym: {
        fields: [
          { key: 'a', tag: 'a', def: 300 },
          { key: 'b', tag: 'b', def: 150 },
          { key: 'h', tag: 'h', def: 260 },
        ],
        build: ({ a, b, h }) =>
          withArea({
            pts: [[0, 0], [a, 0], [a, b], [a / 2, h], [0, b]],
            vnames: ['A', 'B', 'C', 'D', 'E'],
            edges: [{ tag: 'a', i: 0, j: 1 }, { tag: 'b', i: 1, j: 2 }],
            height: { apex: [a / 2, h], foot: [a / 2, 0], tag: 'h' },
            formulaKey: 'shape.attic.sym.formula',
            ok: a > 0 && b > 0 && h >= b,
            warnKey: b > 0 && h > 0 && h < b ? 'shape.warn.apexBelowWall' : undefined,
          }),
      },
      asym: {
        fields: [
          { key: 'a', tag: 'a', def: 300 },
          { key: 'b', tag: 'b', def: 120 },
          { key: 'c', tag: 'c', def: 190 },
          { key: 'h', tag: 'h', def: 260 },
        ],
        build: ({ a, b, c, h }) =>
          withArea({
            pts: [[0, 0], [a, 0], [a, c], [a / 2, h], [0, b]],
            vnames: ['A', 'B', 'C', 'D', 'E'],
            edges: [{ tag: 'a', i: 0, j: 1 }, { tag: 'b', i: 4, j: 0 }, { tag: 'c', i: 1, j: 2 }],
            height: { apex: [a / 2, h], foot: [a / 2, 0], tag: 'h' },
            formulaKey: 'shape.attic.asym.formula',
            ok: a > 0 && b > 0 && c > 0 && h >= Math.max(b, c),
            warnKey:
              b > 0 && c > 0 && h > 0 && h < Math.max(b, c) ? 'shape.warn.apexBelowWall' : undefined,
          }),
      },
    },
  },

  tri: {
    variants: {
      bh: {
        fields: [
          { key: 'b', tag: 'b', def: 300 },
          { key: 'h', tag: 'h', def: 200 },
        ],
        build: ({ b, h }) =>
          withArea({
            pts: [[0, 0], [b, 0], [b / 2, h]],
            vnames: ['A', 'B', 'C'],
            edges: [{ tag: 'b', i: 0, j: 1 }],
            height: { apex: [b / 2, h], foot: [b / 2, 0], tag: 'h' },
            formulaKey: 'shape.tri.bh.formula',
            ok: b > 0 && h > 0,
          }),
      },
      sss: {
        fields: [
          { key: 'c', tag: 'c', def: 300 },
          { key: 'a', tag: 'a', def: 220 },
          { key: 'b', tag: 'b', def: 180 },
        ],
        build: ({ a, b, c }) => {
          const entered = a > 0 && b > 0 && c > 0;
          const ineq = entered && a + b > c && a + c > b && b + c > a;
          // Place C from the side lengths; degenerate placeholder keeps the type honest.
          let pts: Pt[] = [[0, 0], [1, 0], [0.5, 1]];
          if (ineq) {
            const x = (b * b - a * a + c * c) / (2 * c);
            const y = Math.sqrt(Math.max(0, b * b - x * x));
            pts = [[0, 0], [c, 0], [x, y]];
          }
          return withArea({
            pts,
            vnames: ['A', 'B', 'C'],
            edges: [{ tag: 'c', i: 0, j: 1 }, { tag: 'a', i: 1, j: 2 }, { tag: 'b', i: 2, j: 0 }],
            formulaKey: 'shape.tri.sss.formula',
            ok: ineq,
            warnKey: entered && !ineq ? 'shape.warn.triImpossible' : undefined,
          });
        },
      },
    },
  },

  cut: {
    variants: {
      d: {
        fields: [
          { key: 'a', tag: 'a', def: 88 },
          { key: 'b', tag: 'b', def: 88 },
          { key: 'c', tag: 'c', def: 47.2 },
          { key: 'd', tag: 'd', def: 47.2 },
        ],
        build: ({ a, b, c, d }) => {
          const entered = a > 0 && b > 0 && c > 0 && d > 0;
          return withArea({
            pts: [[0, 0], [a, 0], [a, d], [c, b], [0, b]],
            vnames: ['A', 'B', 'C', 'D', 'E'],
            edges: [
              { tag: 'a', i: 0, j: 1 },
              { tag: 'b', i: 4, j: 0 },
              { tag: 'c', i: 4, j: 3 },
              { tag: 'd', i: 1, j: 2 },
            ],
            formulaKey: 'shape.cut.d.formula',
            diag: entered ? Math.hypot(a - c, b - d) : undefined,
            ok: entered && c <= a && d <= b,
            warnKey: !entered
              ? undefined
              : c > a
                ? 'shape.warn.cutTopLonger'
                : d > b
                  ? 'shape.warn.cutRightLonger'
                  : undefined,
          });
        },
      },
    },
  },
};

export const SHAPE_KEYS = Object.keys(SHAPES) as ShapeKey[];

export function modesOf(shape: ShapeKey): string[] {
  return Object.keys(SHAPES[shape].variants);
}

export function defaultMode(shape: ShapeKey): string {
  return modesOf(shape)[0];
}

export function variantOf(shape: ShapeKey, mode: string): ShapeVariant {
  return SHAPES[shape].variants[mode] ?? SHAPES[shape].variants[defaultMode(shape)];
}

/**
 * One plane of a surface — a shape plus the dimensions the master typed.
 *
 * The plane carries NO unit: the unit is chosen once for the whole surface element
 * (as in the reference calculator) and applies to its planes AND its openings. A
 * per-plane unit would let a master enter a 300×250 cm wall next to a 0.9×1.4 m
 * window and silently subtract 12600 m².
 */
export type Plane = {
  shape: ShapeKey;
  mode: string;
  values: Record<string, number>;
};

/** "1 234,5" → 1234.5; empty or unparseable → 0 (an unmeasured side, not an error). */
export function numOf(s: string): number {
  const n = Number(String(s).replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** UI-side plane: dimensions stay strings while being typed ("", "1,5", "1 200"). */
export type PlaneDraft = {
  shape: ShapeKey;
  mode: string;
  values: Record<string, string>;
};

export function newDraft(shape: ShapeKey = 'rect'): PlaneDraft {
  return { shape, mode: defaultMode(shape), values: {} };
}

export function toPlane(d: PlaneDraft): Plane {
  const values: Record<string, number> = {};
  for (const f of variantOf(d.shape, d.mode).fields) values[f.key] = numOf(d.values[f.key] ?? '');
  return { shape: d.shape, mode: d.mode, values };
}

export function toDraft(p: Plane): PlaneDraft {
  const values: Record<string, string> = {};
  for (const f of variantOf(p.shape, p.mode).fields) {
    const v = p.values[f.key];
    values[f.key] = v == null ? '' : String(v);
  }
  return { shape: p.shape, mode: p.mode, values };
}

export function buildPlane(p: Plane): Built {
  const v = variantOf(p.shape, p.mode);
  const values: Record<string, number> = {};
  for (const f of v.fields) values[f.key] = p.values[f.key] ?? 0;
  return v.build(values);
}

/** The outline drawn before anything is typed, so the letters are visible from the start. */
export function buildPlaneOutline(shape: ShapeKey, mode: string): Built {
  const v = variantOf(shape, mode);
  const values: Record<string, number> = {};
  for (const f of v.fields) values[f.key] = f.def;
  return v.build(values);
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Plane area in m² — shoelace in the entered unit, scaled by the factor squared. */
export function planeAreaM2(p: Plane, unit: LengthUnit): number {
  const f = LENGTH_FACTOR[unit] ?? 1;
  return round3(buildPlane(p).area * f * f);
}

/**
 * Σ plane areas, in m². Sums unrounded and rounds ONCE — the backend adds exact
 * BigDecimals and clamps once, so rounding per plane here would drift from it.
 */
export function planesAreaM2(planes: Plane[], unit: LengthUnit): number {
  const f = LENGTH_FACTOR[unit] ?? 1;
  return round3(planes.reduce((s, p) => s + buildPlane(p).area * f * f, 0));
}

/**
 * Pre-shapes payloads stored bare `{l, w}` rectangles in metres. Read them as
 * rectangle planes so old measurements open in the shape editor unchanged; a save
 * then writes the new form (the backend still accepts both). Such a payload has no
 * unit, so it reads back as metres — see `SurfacePayload.unit`.
 */
export function planeFromLegacy(l: number, w: number): Plane {
  return { shape: 'rect', mode: 'd', values: { a: l, b: w } };
}
