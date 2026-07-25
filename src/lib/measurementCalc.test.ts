import { describe, it, expect } from 'vitest';
import { computeMeasurementResult, recomputeTree, unitForType } from './measurementCalc.ts';
import type { MeasurementsResponse } from '@/api/types.ts';

/**
 * These numbers are the SAME cases the backend's MeasurementCalcTest pins — the two
 * implementations must agree, or an offline element would show one figure and sync as another.
 */
describe('computeMeasurementResult', () => {
  it('SURFACE: Σ planes − Σ openings, in the payload unit', () => {
    // 5 × 3 m wall minus one 1 × 2 m opening = 13 m².
    const r = computeMeasurementResult('SURFACE', {
      unit: 'M',
      segments: [{ shape: 'rect', mode: 'd', values: { a: 5, b: 3 } }],
      openings: [{ w: 1, h: 2, n: 1 }],
    });
    expect(r).toBeCloseTo(13, 3);
  });

  it('SURFACE: a legacy {l, w} segment reads as a rectangle in METRES', () => {
    const r = computeMeasurementResult('SURFACE', {
      segments: [{ l: 5.31, w: 3.69 }],
      openings: [],
    });
    expect(r).toBeCloseTo(19.594, 2); // the pre-shapes example from the codebase
  });

  it('SURFACE: centimetres are scaled (300 × 250 cm = 7.5 m²)', () => {
    const r = computeMeasurementResult('SURFACE', {
      unit: 'CM',
      segments: [{ shape: 'rect', mode: 'd', values: { a: 300, b: 250 } }],
      openings: [],
    });
    expect(r).toBeCloseTo(7.5, 3);
  });

  it('PARTITION: 2 sides + end by default', () => {
    // H2 × W3 twice + H2 × D0.5 = 12 + 1 = 13
    const r = computeMeasurementResult('PARTITION', {
      height: 2, width: 3, depth: 0.5,
      faces: { left: true, right: true, end: true, top: false },
    });
    expect(r).toBeCloseTo(13, 3);
  });

  it('LINEAR: (H + H + W) × qty', () => {
    const r = computeMeasurementResult('LINEAR', {
      height: 1.5, width: 1,
      sides: { left: true, right: true, top: true, bottom: false },
      qty: 3,
    });
    expect(r).toBeCloseTo(12, 3);
  });

  it('ELECTRICAL_POINTS: Σ counts (шт)', () => {
    const r = computeMeasurementResult('ELECTRICAL_POINTS', {
      points: [
        { type: 'Розетка', count: 12, heights: [300] },
        { type: 'Вимикач', count: 3, heights: [900] },
      ],
    });
    expect(r).toBe(15);
  });

  const chasePayload = {
    busLevel: 2600, busFromTop: true, busLength: 1000, busChase: false, reservePct: 10,
    points: [
      { kind: 'socket', h: 300, qty: 1, chase: true },   // drop 2300 mm
      { kind: 'outlet', h: 2600, qty: 1, chase: false }, // drop 0 mm
    ],
  };

  it('SHTROBA: only what is actually cut — unchased bus and drops excluded, no reserve', () => {
    // bus not chased (0) + the flagged 2300 mm drop = 2.3 м.пог
    expect(computeMeasurementResult('SHTROBA', chasePayload)).toBeCloseTo(2.3, 3);
  });

  it('CABLE: bus + EVERY drop, plus the reserve', () => {
    // (1000 + 2300 + 0) × 1.10 = 3630 mm = 3.63 m
    expect(computeMeasurementResult('CABLE', chasePayload)).toBeCloseTo(3.63, 3);
  });

  it('never returns NaN on a garbage payload (a wrong number would flow into money)', () => {
    expect(computeMeasurementResult('SURFACE', {} as never)).toBe(0);
    expect(computeMeasurementResult('LINEAR', { height: NaN } as never)).toBe(0);
  });
});

describe('unitForType', () => {
  it('pins each type to its unit (substitution into estimate lines works by unit)', () => {
    expect(unitForType('SURFACE')).toBe('M2');
    expect(unitForType('PARTITION')).toBe('M2');
    expect(unitForType('LINEAR')).toBe('LINEAR_METER');
    expect(unitForType('SHTROBA')).toBe('LINEAR_METER');
    expect(unitForType('ELECTRICAL_POINTS')).toBe('PIECE');
    expect(unitForType('CABLE')).toBe('M');
  });
});

describe('recomputeTree', () => {
  it('buckets by unit and keeps CABLE (м) out of the area/linear/piece totals', () => {
    const tree: MeasurementsResponse = {
      areaTotal: 0, linearTotal: 0, pieceTotal: 0,
      rooms: [{
        id: 'r1', name: 'Кухня', sortOrder: 0, areaTotal: 0, linearTotal: 0, pieceTotal: 0,
        items: [
          { id: 'a', name: 'Стеля', type: 'SURFACE', unit: 'M2', result: 12, payload: {} as never, sortOrder: 0 },
          { id: 'b', name: 'Відкоси', type: 'LINEAR', unit: 'LINEAR_METER', result: 5, payload: {} as never, sortOrder: 1 },
          { id: 'c', name: 'Точки', type: 'ELECTRICAL_POINTS', unit: 'PIECE', result: 8, payload: {} as never, sortOrder: 2 },
          { id: 'd', name: 'Кабель', type: 'CABLE', unit: 'M', result: 30, payload: {} as never, sortOrder: 3 },
        ],
      }],
    };

    const out = recomputeTree(tree);

    expect(out.rooms[0]).toMatchObject({ areaTotal: 12, linearTotal: 5, pieceTotal: 8 });
    expect(out).toMatchObject({ areaTotal: 12, linearTotal: 5, pieceTotal: 8 });
  });
});
