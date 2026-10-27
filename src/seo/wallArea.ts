// The wall-area calculator (kalkulyator-ploshchi-stin.html): pure geometry, no norms and no backend
// — so it lives here and runs in the browser. The build prints the typical-case table from this same
// function (scripts/seo-pages-plugin.ts), so the page's figures and the form's answers cannot drift.
// No imports: the Vite config loads this file too.

/** A window or door: width × height in metres, `count` of the same size. */
export interface Opening {
  width: number;
  height: number;
  count: number;
}

/** A rectangular room in metres. */
export interface Room {
  length: number;
  width: number;
  height: number;
  windows: Opening[];
  doors: Opening[];
}

export interface WallArea {
  perimeter: number;
  /** Every wall, openings included: perimeter × height. */
  wallsGross: number;
  windows: number;
  doors: number;
  /** What gets plastered, puttied or painted: the walls minus windows and doors. */
  wallsNet: number;
  /** Floor and ceiling of a rectangular room are the same figure. */
  floor: number;
  /** The perimeter minus every doorway — the skirting does not run across a door. */
  skirting: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const openingsArea = (list: Opening[]) => list.reduce((s, o) => s + o.width * o.height * o.count, 0);

export function wallArea(room: Room): WallArea {
  const perimeter = 2 * (room.length + room.width);
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
    floor: round2(room.length * room.width),
    skirting: round2(Math.max(0, perimeter - doorWidths)),
  };
}

export interface WallAreaCase {
  id: string;
  label: string;
  room: Room;
}

const WINDOW = { width: 1.4, height: 1.5, count: 1 };
const DOOR = { width: 0.8, height: 2.0, count: 1 };

/** The page's typical cases, printed at build time. `room` is the one the plaster page's lede quotes. */
export const WALL_AREA_CASES: WallAreaCase[] = [
  {
    id: 'bath',
    label: 'Ванна 1,7×2 м, стеля 2,5 м, двері 0,7×2 м, без вікна',
    room: { length: 2, width: 1.7, height: 2.5, windows: [], doors: [{ width: 0.7, height: 2.0, count: 1 }] },
  },
  {
    id: 'kitchen',
    label: 'Кухня 2,5×3 м, стеля 2,6 м, вікно 1,4×1,5 м, двері 0,8×2 м',
    room: { length: 3, width: 2.5, height: 2.6, windows: [WINDOW], doors: [DOOR] },
  },
  {
    id: 'room',
    label: 'Кімната 3×4 м, стеля 2,7 м, вікно 1,4×1,5 м, двері 0,8×2 м',
    room: { length: 4, width: 3, height: 2.7, windows: [WINDOW], doors: [DOOR] },
  },
  {
    id: 'living',
    label: 'Вітальня 4×5 м, стеля 2,7 м, два вікна 1,4×1,5 м, двері 0,9×2,1 м',
    room: { length: 5, width: 4, height: 2.7, windows: [{ ...WINDOW, count: 2 }], doors: [{ width: 0.9, height: 2.1, count: 1 }] },
  },
];
