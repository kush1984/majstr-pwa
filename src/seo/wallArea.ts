// The wall-area calculator (kalkulyator-ploshchi-stin.html): pure geometry, no norms and no backend
// — so it lives here and runs in the browser. The build prints the typical-case table from this same
// function (scripts/seo-pages-plugin.ts), so the page's figures and the form's answers cannot drift.
// The room's plan is a shape from the app's own src/lib/shapes.ts — the same polygons and letters
// the measurements editor draws. Relative imports only: the Vite config loads this file too.

import { buildPlane, type Built, type Pt } from '../lib/shapes.ts';

/** The plan shapes a ROOM can have. Mansard and triangle are walls (a gable), not floor plans. */
export const PLAN_SHAPES = ['rect', 'lshape', 'cut'] as const;
export type PlanShape = (typeof PLAN_SHAPES)[number];

/** A window or door: width × height in metres, `count` of the same size. */
export interface Opening {
  width: number;
  height: number;
  count: number;
}

/** A room in metres: its plan (the shape's letters → sizes), its ceiling height, its openings. */
export interface Room {
  plan: { shape: PlanShape; values: Record<string, number> };
  height: number;
  windows: Opening[];
  doors: Opening[];
}

export interface WallArea {
  /** Σ every wall of the plan — for an L-shaped room the same as its overall rectangle. */
  perimeter: number;
  /** Every wall, openings included: perimeter × height. */
  wallsGross: number;
  windows: number;
  doors: number;
  /** What gets plastered, puttied or painted: the walls minus windows and doors. */
  wallsNet: number;
  /** Floor and ceiling are the same figure — the plan's area. */
  floor: number;
  /** The perimeter minus every doorway — the skirting does not run across a door. */
  skirting: number;
  /** Cut corner only: the slanted wall, for a cross-check with the tape. */
  slope?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const openingsArea = (list: Opening[]) => list.reduce((s, o) => s + o.width * o.height * o.count, 0);

function polygonPerimeter(pts: Pt[]): number {
  return pts.reduce((s, p, i) => {
    const q = pts[(i + 1) % pts.length];
    return s + Math.hypot(q[0] - p[0], q[1] - p[1]);
  }, 0);
}

/** The plan as the app builds it — `ok: false` (with its `warnKey`) when the sizes make no room. */
export function buildPlan(plan: Room['plan']): Built {
  return buildPlane({ shape: plan.shape, mode: 'd', values: plan.values });
}

/** Null when the plan's sizes do not form a room (a cut-out bigger than the room, say). */
export function wallArea(room: Room): WallArea | null {
  const plan = buildPlan(room.plan);
  if (!plan.ok) return null;
  const perimeter = polygonPerimeter(plan.pts);
  const wallsGross = perimeter * room.height;
  const windows = openingsArea(room.windows);
  const doors = openingsArea(room.doors);
  const doorWidths = room.doors.reduce((s, d) => s + d.width * d.count, 0);
  return {
    perimeter: round2(perimeter),
    wallsGross: round2(wallsGross),
    windows: round2(windows),
    doors: round2(doors),
    wallsNet: round2(Math.max(0, wallsGross - windows - doors)),
    floor: round2(plan.area),
    skirting: round2(Math.max(0, perimeter - doorWidths)),
    ...(plan.diag != null ? { slope: round2(plan.diag) } : {}),
  };
}

export interface WallAreaCase {
  id: string;
  label: string;
  room: Room;
}

const WINDOW = { width: 1.4, height: 1.5, count: 1 };
const DOOR = { width: 0.8, height: 2.0, count: 1 };
const rect = (a: number, b: number) => ({ shape: 'rect' as const, values: { a, b } });

/** The page's typical cases, printed at build time. `room` is the one the plaster page's lede quotes. */
export const WALL_AREA_CASES: WallAreaCase[] = [
  {
    id: 'bath',
    label: 'Ванна 1,7×2 м, стеля 2,5 м, двері 0,7×2 м, без вікна',
    room: { plan: rect(2, 1.7), height: 2.5, windows: [], doors: [{ width: 0.7, height: 2.0, count: 1 }] },
  },
  {
    id: 'kitchen',
    label: 'Кухня 2,5×3 м, стеля 2,6 м, вікно 1,4×1,5 м, двері 0,8×2 м',
    room: { plan: rect(3, 2.5), height: 2.6, windows: [WINDOW], doors: [DOOR] },
  },
  {
    id: 'room',
    label: 'Кімната 3×4 м, стеля 2,7 м, вікно 1,4×1,5 м, двері 0,8×2 м',
    room: { plan: rect(4, 3), height: 2.7, windows: [WINDOW], doors: [DOOR] },
  },
  {
    id: 'living',
    label: 'Вітальня 4×5 м, стеля 2,7 м, два вікна 1,4×1,5 м, двері 0,9×2,1 м',
    room: { plan: rect(5, 4), height: 2.7, windows: [{ ...WINDOW, count: 2 }], doors: [{ width: 0.9, height: 2.1, count: 1 }] },
  },
  {
    id: 'lshape',
    label: 'Г-подібна кімната 5×4 м з вирізом 2×1,5 м, стеля 2,7 м, два вікна 1,4×1,5 м, двері 0,8×2 м',
    room: { plan: { shape: 'lshape', values: { A: 5, B: 4, a: 2, b: 1.5 } }, height: 2.7, windows: [{ ...WINDOW, count: 2 }], doors: [DOOR] },
  },
];
