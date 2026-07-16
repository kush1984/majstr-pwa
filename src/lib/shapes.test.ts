import { describe, it, expect } from 'vitest';
import {
  buildPlane,
  planeAreaM2,
  planeFromLegacy,
  planesAreaM2,
  shoelace,
  toPlane,
  type Plane,
} from './shapes.ts';

const plane = (shape: Plane['shape'], mode: string, values: Record<string, number>): Plane => ({
  shape,
  mode,
  values,
});

describe('shoelace', () => {
  it('measures a unit square', () => {
    expect(shoelace([[0, 0], [1, 0], [1, 1], [0, 1]])).toBe(1);
  });

  it('is orientation-independent (clockwise = counter-clockwise)', () => {
    const cw = shoelace([[0, 1], [1, 1], [1, 0], [0, 0]]);
    expect(cw).toBe(shoelace([[0, 0], [1, 0], [1, 1], [0, 1]]));
  });
});

describe('rectangle', () => {
  it('area = a × b (the Excel 5.31 × 3.69 case, in metres)', () => {
    expect(planeAreaM2(plane('rect', 'd', { a: 5.31, b: 3.69 }), 'M')).toBe(19.594);
  });

  it('a legacy {l, w} segment reads back as the same rectangle', () => {
    expect(planeAreaM2(planeFromLegacy(5.31, 3.69), 'M')).toBe(19.594);
  });

  it('needs both sides to be a figure', () => {
    expect(buildPlane(plane('rect', 'd', { a: 5, b: 0 })).ok).toBe(false);
    expect(planeAreaM2(plane('rect', 'd', { a: 5, b: 0 }), 'M')).toBe(0);
  });
});

describe('planes sum', () => {
  it('sums several planes (the two-segment Excel case)', () => {
    // 2.71×3.44 + 3.69×4.14 = 9.322 + 15.277
    expect(
      planesAreaM2(
        [plane('rect', 'd', { a: 2.71, b: 3.44 }), plane('rect', 'd', { a: 3.69, b: 4.14 })],
        'M',
      ),
    ).toBe(24.599);
  });

  it('rounds once at the end, not per plane (the backend clamps once)', () => {
    // Two planes of 0.0005 m² each: rounding per plane would give 0.001+0.001 = 0.002.
    const p = plane('rect', 'd', { a: 0.001, b: 0.5 });
    expect(planesAreaM2([p, p], 'M')).toBe(0.001);
  });

  it('mixes shapes — a mansard ceiling is 2 rectangles + a triangle', () => {
    const total = planesAreaM2(
      [
        plane('rect', 'd', { a: 2, b: 3 }),
        plane('rect', 'd', { a: 2, b: 3 }),
        plane('tri', 'bh', { b: 4, h: 1.5 }),
      ],
      'M',
    );
    expect(total).toBe(15); // 6 + 6 + 3
  });
});

describe('units', () => {
  it('converts cm² to m² (300 × 250 cm = 7.5 m²)', () => {
    expect(planeAreaM2(plane('rect', 'd', { a: 300, b: 250 }), 'CM')).toBe(7.5);
  });

  it('converts mm² to m² (1000 × 2000 mm = 2 m²)', () => {
    expect(planeAreaM2(plane('rect', 'd', { a: 1000, b: 2000 }), 'MM')).toBe(2);
  });
});

describe('trapezoid', () => {
  it('area = (a + b) / 2 × h', () => {
    // (180 + 300) / 2 × 200 = 48000 cm² = 4.8 m²
    expect(planeAreaM2(plane('trap', 'd', { a: 180, b: 300, h: 200 }), 'CM')).toBe(4.8);
  });

  it('notes that equal sides make it a rectangle', () => {
    expect(buildPlane(plane('trap', 'd', { a: 200, b: 200, h: 100 })).noteKey).toBe(
      'shape.note.trapIsRect',
    );
  });

  it('draws a dashed height with the h tag', () => {
    expect(buildPlane(plane('trap', 'd', { a: 180, b: 300, h: 200 })).height?.tag).toBe('h');
  });
});

describe('mansard', () => {
  it('symmetric: area = a × (b + h) / 2', () => {
    // 300 × (150 + 260) / 2 = 61500 cm² = 6.15 m²
    expect(planeAreaM2(plane('attic', 'sym', { a: 300, b: 150, h: 260 }), 'CM')).toBe(6.15);
  });

  it('asymmetric: trapezoid + triangle', () => {
    // 62250 cm² = 6.225 m²
    expect(planeAreaM2(plane('attic', 'asym', { a: 300, b: 120, c: 190, h: 260 }), 'CM')).toBe(
      6.225,
    );
  });

  it('rejects an apex below the wall', () => {
    const built = buildPlane(plane('attic', 'sym', { a: 300, b: 200, h: 150 }));
    expect(built.ok).toBe(false);
    expect(built.warnKey).toBe('shape.warn.apexBelowWall');
  });

  it('allows a flat top (h = b)', () => {
    expect(buildPlane(plane('attic', 'sym', { a: 300, b: 150, h: 150 })).ok).toBe(true);
  });
});

describe('triangle', () => {
  it('base + height: area = b × h / 2', () => {
    // 300 × 200 / 2 = 30000 cm² = 3 m²
    expect(planeAreaM2(plane('tri', 'bh', { b: 300, h: 200 }), 'CM')).toBe(3);
  });

  it('three sides: the 3-4-5 triangle has area 6', () => {
    expect(planeAreaM2(plane('tri', 'sss', { a: 3, b: 4, c: 5 }), 'M')).toBe(6);
  });

  it('three sides: warns when the triangle inequality fails', () => {
    const built = buildPlane(plane('tri', 'sss', { a: 1, b: 2, c: 5 }));
    expect(built.ok).toBe(false);
    expect(built.warnKey).toBe('shape.warn.triImpossible');
    expect(built.area).toBe(0);
  });

  it('three sides: stays silent until all three are entered', () => {
    expect(buildPlane(plane('tri', 'sss', { a: 3, b: 0, c: 0 })).warnKey).toBeUndefined();
  });
});

describe('cut corner', () => {
  it('area = a × b − (a−c)(b−d) / 2', () => {
    // 88×88 − 40.8×40.8/2 = 7744 − 832.32 = 6911.68 cm² = 0.691 m²
    expect(planeAreaM2(plane('cut', 'd', { a: 88, b: 88, c: 47.2, d: 47.2 }), 'CM')).toBe(0.691);
  });

  it('reports the slope to cross-check with a tape', () => {
    const built = buildPlane(plane('cut', 'd', { a: 88, b: 88, c: 47.2, d: 47.2 }));
    expect(built.diag).toBeCloseTo(57.7, 1); // hypot(40.8, 40.8)
  });

  it('rejects a top side longer than the bottom', () => {
    const built = buildPlane(plane('cut', 'd', { a: 50, b: 88, c: 60, d: 40 }));
    expect(built.ok).toBe(false);
    expect(built.warnKey).toBe('shape.warn.cutTopLonger');
  });

  it('rejects a right side longer than the left', () => {
    expect(buildPlane(plane('cut', 'd', { a: 88, b: 50, c: 40, d: 60 })).warnKey).toBe(
      'shape.warn.cutRightLonger',
    );
  });
});

describe('drafts', () => {
  it('parses comma decimals and treats blanks/garbage as zero', () => {
    expect(toPlane({ shape: 'rect', mode: 'd', values: { a: '5,31', b: '3.69' } }).values).toEqual({
      a: 5.31,
      b: 3.69,
    });
    expect(toPlane({ shape: 'rect', mode: 'd', values: { a: '', b: 'abc' } }).values).toEqual({
      a: 0,
      b: 0,
    });
  });
});
