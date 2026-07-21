import { describe, it, expect } from 'vitest';
import { busLengthMm, clamp01, defaultBus, defaultPoints } from './planBus.ts';

describe('planBus.busLengthMm', () => {
  it('measures a horizontal run at the room width', () => {
    expect(busLengthMm([{ x: 0, y: 0 }, { x: 1, y: 0 }], 4000, 3000)).toBe(4000);
  });

  it('sums an L-shaped run around a corner', () => {
    // full width (4000) + full length (3000)
    expect(busLengthMm([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], 4000, 3000)).toBe(7000);
  });

  it('measures a diagonal with the room scale on each axis (3-4-5)', () => {
    expect(busLengthMm([{ x: 0, y: 0 }, { x: 1, y: 1 }], 4000, 3000)).toBe(5000);
  });

  it('is 0 for fewer than two vertices', () => {
    expect(busLengthMm([{ x: 0.5, y: 0.5 }], 4000, 3000)).toBe(0);
    expect(busLengthMm([], 4000, 3000)).toBe(0);
  });
});

describe('planBus helpers', () => {
  it('clamps coordinates into the room', () => {
    expect(clamp01(-0.2)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(0.3)).toBe(0.3);
  });

  it('defaults the bus to the top wall when chased from the top', () => {
    expect(defaultBus(true)[0].y).toBeLessThan(0.5);
    expect(defaultBus(false)[0].y).toBeGreaterThan(0.5);
  });

  it('spaces reference points and centres a single one', () => {
    expect(defaultPoints(1, true)[0].x).toBe(0.5);
    expect(defaultPoints(3, true)).toHaveLength(3);
    expect(defaultPoints(0, true)).toEqual([]);
  });
});
