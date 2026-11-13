import { describe, expect, it } from 'vitest';
import {
  countPosition,
  layoutSurface,
  spareTiles,
  tilesByArea,
  TileLayoutError,
  type SurfaceInput,
} from './tileLayout.ts';

/**
 * Every expected figure below was counted by hand (iteration-tile-layout, «Еталони»), never read back
 * off the engine. The wall is the plan's: 1850 × 2550, a 300×600 tile laid landscape, 2 mm joints,
 * 2 mm against the walls — so the frame is 1846 × 2546 and a step is 602 across, 302 up.
 */
const wall: SurfaceInput = {
  width: 1850,
  height: 2550,
  tile: { w: 600, h: 300 },
  joint: 2,
  edgeGap: 2,
  pattern: 'STRAIGHT',
  hStart: 'CORNER',
  vStart: 'CORNER',
};

const edge = (l: ReturnType<typeof layoutSurface>, side: string) => l.edges.find((e) => e.side === side);

describe('one wall, straight', () => {
  it('from the corner: three whole columns and a 40 mm strip, eight rows and a 130 mm top', () => {
    const l = layoutSurface(wall);
    expect(l.full).toBe(24);
    expect(l.cut).toBe(12); // 8 strips + 3 top pieces + the corner
    expect(edge(l, 'R')).toEqual({ side: 'R', min: 40, narrow: true });
    expect(edge(l, 'T')).toEqual({ side: 'T', min: 130, narrow: false });
    expect(edge(l, 'L')).toBeUndefined();
    expect(l.maxTiles).toBe(36);
    // 8 strips, two per tile (one off each factory end) = 4; 3 top pieces, two per tile = 2; the
    // 40 × 130 corner from the last top offcut, turned 180° = 0. 24 + 4 + 2.
    expect(l.minTiles).toBe(30);
  });

  it('symmetric: 320 · 600 · 600 · 320, no narrow strip', () => {
    const l = layoutSurface({ ...wall, hStart: 'SYMMETRIC' });
    expect(edge(l, 'L')?.min).toBe(320);
    expect(edge(l, 'R')?.min).toBe(320);
    expect(l.edges.some((e) => e.narrow)).toBe(false);
    expect(l.full).toBe(16);
    expect(l.cut).toBe(20);
    // 16 strips of 320 — the 278 offcut fits none — 16 tiles; the two 600 × 130 tops from one tile
    // (its 600 × 168 offcut, turned 180°, keeps factory edges where the second needs them) — 1; the
    // two 320 × 130 corners from one tile the same way — 1. 16 full + 16 + 1 + 1.
    expect(l.minTiles).toBe(34);
    expect(l.maxTiles).toBe(36);
  });

  it('AUTO finds a start with no strip under a third of the tile', () => {
    const l = layoutSurface({ ...wall, hStart: 'AUTO' });
    expect(edge(l, 'L')?.min).toBeGreaterThanOrEqual(200);
    expect(edge(l, 'R')?.min).toBeGreaterThanOrEqual(200);
  });

  it('a tile on the axis leaves 19 mm each side — narrow, and avoidable', () => {
    const l = layoutSurface({ ...wall, hStart: 'CENTER' });
    expect(edge(l, 'L')).toMatchObject({ min: 19, narrow: true });
    expect(l.hints).not.toContain('NARROW_UNAVOIDABLE');
  });

  it('an exact fit cuts nothing', () => {
    const l = layoutSurface({ ...wall, width: 4 * 600 + 3 * 2 + 4, height: 3 * 300 + 2 * 2 + 4 });
    expect(l.full).toBe(12);
    expect(l.cut).toBe(0);
    expect(l.edges).toEqual([]);
    expect(l.minTiles).toBe(12);
  });

  it('no joint and no gap: tiles meet edge to edge', () => {
    const l = layoutSurface({ ...wall, width: 1200, height: 600, joint: 0, edgeGap: 0 });
    expect(l.full).toBe(4);
    expect(l.cut).toBe(0);
  });
});

describe('a manual start — where the master dragged the grid', () => {
  it('the grid starts where it was put, and the strips follow it', () => {
    // A tile from −300 to 300: the first piece on the left is 2…300 = 298 wide (frame from 2).
    const l = layoutSurface({ ...wall, hStart: 'MANUAL', vStart: 'MANUAL', manualOrigin: { x: 302, y: 2 } });
    expect(l.edges.find((e) => e.side === 'L')?.min).toBe(298);
    expect(l.origin).toEqual({ x: 302, y: 2 });
  });

  it('dragged by a whole step it is the same layout', () => {
    const a = layoutSurface({ ...wall, hStart: 'MANUAL', vStart: 'MANUAL', manualOrigin: { x: 100, y: 50 } });
    const b = layoutSurface({ ...wall, hStart: 'MANUAL', vStart: 'MANUAL', manualOrigin: { x: 100 + 602, y: 50 - 302 } });
    expect(b.pieces).toEqual(a.pieces);
  });

  it('a manual start with no origin is the corner', () => {
    expect(layoutSurface({ ...wall, hStart: 'MANUAL', vStart: 'MANUAL' }).pieces)
      .toEqual(layoutSurface(wall).pieces);
  });
});

describe('openings', () => {
  // 2050 wide, a 700 × 2000 door 1000 mm from the left; corner start. Columns 2–602, 604–1204,
  // 1206–1806, 1808–2048 (a 240 strip); the door takes 1000–1700.
  const door = { ...wall, width: 2050, openings: [{ x: 1000, y: 0, w: 700, h: 2000 }] };

  it('tiles inside the door are not laid; beside it they are cut; over its top corner they are shaped', () => {
    const l = layoutSurface(door);
    expect(l.full).toBe(10); // 6 + 1 + 3: column one on rows 0–6, and all three on row 7
    expect(l.shaped).toBe(2); // the two tiles across the door's top line
    expect(l.cut).toBe(24);
    expect(l.maxTiles).toBe(36);
  });

  it('a 396 and a 106 beside the door come from one tile', () => {
    // Six rows of (396 + 106) = 6 tiles, eight 240 strips two per tile = 4, three top pieces = 2:
    // 10 full + 2 shaped + 12.
    expect(layoutSurface(door).minTiles).toBe(24);
  });

  it('the area laid is the wall less the door and the joints', () => {
    const l = layoutSurface(door);
    expect(l.laidArea).toBeGreaterThan(3.7);
    expect(l.laidArea).toBeLessThan(2.046 * 2.546 - 1.4);
  });
});

describe('offsets', () => {
  it('half offset: a row end and the next row start come from one tile', () => {
    // 1500 × 606: two whole rows. Row 0: 600, 600, 292. Row 1 (shifted 301): 299, 600, 593.
    // The 299 (factory on its right) leaves a 299 offcut factory on its left — the 292 fits it.
    const l = layoutSurface({ ...wall, width: 1500, height: 606, pattern: 'OFFSET_1_2' });
    expect(l.full).toBe(3);
    expect(l.cut).toBe(3);
    expect(l.maxTiles).toBe(6);
    expect(l.minTiles).toBe(5);
  });

  it('half offset on this wall cannot avoid a narrow end, and says so', () => {
    // Two whole tiles a row leave 640 for both ends; a 301 shift turns any end of 200–440 into
    // one under 200 on the next row.
    const l = layoutSurface({ ...wall, pattern: 'OFFSET_1_2', hStart: 'AUTO' });
    expect(l.edges.some((e) => e.narrow)).toBe(true);
    expect(l.hints).toContain('NARROW_UNAVOIDABLE');
  });

  it('a half offset on a tile longer than 380 mm is flagged (ANSI A108.02), a 300 mm one is not', () => {
    expect(layoutSurface({ ...wall, pattern: 'OFFSET_1_2' }).hints).toContain('OFFSET_HALF_LONG');
    expect(layoutSurface({ ...wall, pattern: 'OFFSET_1_3' }).hints).not.toContain('OFFSET_HALF_LONG');
    expect(layoutSurface({ ...wall, tile: { w: 300, h: 300 }, pattern: 'OFFSET_1_2' }).hints)
      .not.toContain('OFFSET_HALF_LONG');
  });

  it('AUTO on a third offset is never worse than the corner', () => {
    const corner = layoutSurface({ ...wall, pattern: 'OFFSET_1_3' });
    const auto = layoutSurface({ ...wall, pattern: 'OFFSET_1_3', hStart: 'AUTO' });
    const narrowest = (l: typeof auto) => Math.min(...l.edges.filter((e) => e.side === 'L' || e.side === 'R').map((e) => e.min));
    expect(narrowest(auto)).toBeGreaterThanOrEqual(narrowest(corner));
  });
});

describe('format hints', () => {
  it('a tile wider than the surface', () => {
    const l = layoutSurface({ ...wall, width: 500, height: 2000 });
    expect(l.hints).toContain('TILE_BIGGER_THAN_SURFACE');
    expect(l.hints).not.toContain('NARROW_UNAVOIDABLE');
  });

  it('more cut pieces than whole tiles', () => {
    expect(layoutSurface({ ...wall, hStart: 'SYMMETRIC' }).hints).toContain('MOSTLY_CUT');
    expect(layoutSurface(wall).hints).not.toContain('MOSTLY_CUT');
  });
});

describe('invalid input names the field', () => {
  const code = (s: SurfaceInput) => {
    try {
      layoutSurface(s);
      return null;
    } catch (e) {
      return e instanceof TileLayoutError ? e.code : 'other';
    }
  };

  const cases: [SurfaceInput, string][] = [
    [{ ...wall, width: 0 }, 'SURFACE'],
    [{ ...wall, tile: { w: 600, h: 0 } }, 'TILE'],
    [{ ...wall, joint: 300 }, 'JOINT'],
    [{ ...wall, edgeGap: -1 }, 'GAP'],
    [{ ...wall, openings: [{ x: 1500, y: 0, w: 700, h: 2000 }] }, 'OPENING'],
    [{ ...wall, openings: [{ x: 0, y: 0, w: 700, h: 2000 }, { x: 600, y: 0, w: 700, h: 2000 }] }, 'OPENING'],
  ];
  it.each(cases)('%#', (s, expected) => {
    expect(code(s)).toBe(expected);
  });
});

describe('a position', () => {
  it('offcuts travel between walls and the spare is added once', () => {
    const a = layoutSurface(wall);
    const b = layoutSurface(wall);
    const c = countPosition([a, b], wall.tile);
    expect(c.maxTiles).toBe(72);
    expect(c.minTiles).toBeLessThanOrEqual(a.minTiles + b.minTiles);
    expect(c.spare).toBe(4); // 5 % of 72 = 3,6 → 4
  });

  it('the spare is 5 %, never under two tiles', () => {
    expect(spareTiles(36)).toBe(2);
    expect(spareTiles(41)).toBe(3);
    expect(spareTiles(0)).toBe(0);
  });

  it('by area: 4,72 m² + 10 % of 0,18 m² tiles is 29', () => {
    expect(tilesByArea(4.72, { w: 600, h: 300 }, 10)).toBe(29);
  });
});

it('a 5 × 3 m wall with a door and AUTO on both axes stays well inside the 300 ms phone budget', () => {
  const t0 = performance.now();
  layoutSurface({
    ...wall, width: 5000, height: 3000, pattern: 'OFFSET_1_3', hStart: 'AUTO', vStart: 'AUTO',
    openings: [{ x: 1000, y: 0, w: 800, h: 2000 }],
  });
  expect(performance.now() - t0).toBeLessThan(150);
});
