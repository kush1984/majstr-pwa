import { describe, expect, it } from 'vitest';
import {
  lineIsFloor,
  mmToMetres,
  readAsMm,
  sizeToMm,
  canSave,
  evaluate,
  formatFromName,
  fromStored,
  isTilingLine,
  laidTile,
  measurementItems,
  roomSurfaces,
  shouldOfferMeasurements,
  surfacesFromMeasurements,
  toRequest,
  wall,
  type LayoutDraft,
} from './tileLayoutModel.ts';
import type { MeasurementItem, TileLayoutView } from '@/api/types.ts';

const names = { wall: (l: string) => `Стіна ${l}`, floor: 'Підлога' };

const draft = (over: Partial<LayoutDraft> = {}): LayoutDraft => ({
  version: 1,
  format: { short: 300, long: 600 },
  orientation: 'LANDSCAPE',
  joint: 2,
  surfaces: [wall('Стіна А', 1850, 2550)],
  unplaced: [],
  ...over,
});

describe('reading the line', () => {
  it('finds the format however it is written, short side first', () => {
    expect(formatFromName('Укладання плитки 300х600')).toEqual({ short: 300, long: 600 });
    expect(formatFromName('плитка 600 × 300')).toEqual({ short: 300, long: 600 });
    expect(formatFromName('Плитка 30x60 у ванній')).toEqual({ short: 300, long: 600 });
    expect(formatFromName('Укладання плитки кабанчик')).toBeNull();
  });

  it('a tiling line is m² work that is TILING or names tile', () => {
    expect(isTilingLine({ type: 'WORK', unit: 'M2', name: 'Укладання плитки 300х600', trade: null })).toBe(true);
    expect(isTilingLine({ type: 'WORK', unit: 'M2', name: 'Облицювання фартуха', trade: 'TILING' })).toBe(true);
    expect(isTilingLine({ type: 'WORK', unit: 'LINEAR_METER', name: 'Плитка-плінтус', trade: 'TILING' })).toBe(false);
    expect(isTilingLine({ type: 'MATERIAL', unit: 'M2', name: 'Плитка 300х600', trade: 'TILING' })).toBe(false);
    expect(isTilingLine({ type: 'WORK', unit: 'M2', name: 'Фарбування стін', trade: 'PAINTER' })).toBe(false);
  });

  it('landscape lays the long side along the row', () => {
    expect(laidTile(draft())).toEqual({ w: 600, h: 300 });
    expect(laidTile(draft({ orientation: 'PORTRAIT' }))).toEqual({ w: 300, h: 600 });
  });
});

describe('a room', () => {
  it('four walls and a floor; the walls when the line is not the floor', () => {
    const s = roomSurfaces(2050, 1850, 2550, 20, names);
    expect(s.map((x) => [x.name, x.width, x.height, x.enabled])).toEqual([
      ['Стіна А', 2050, 2550, true], ['Стіна Б', 1850, 2550, true],
      ['Стіна В', 2050, 2550, true], ['Стіна Г', 1850, 2550, true],
      ['Підлога', 2050, 1850, false],
    ]);
  });

  it('the floor alone when the line is the floor area', () => {
    const s = roomSurfaces(2050, 1850, 2550, 3.8, names);
    expect(s.filter((x) => x.enabled).map((x) => x.name)).toEqual(['Підлога']);
    expect(s[4].floor).toBe(true);
  });
});

describe('from the measurements', () => {
  const item = (over: Partial<MeasurementItem>): MeasurementItem => ({
    id: 'm1', name: 'Стіни', type: 'SURFACE', unit: 'M2', result: 10, sortOrder: 0,
    payload: { unit: 'M', segments: [], openings: [] }, ...over,
  });

  it('rectangles become surfaces in mm; openings come back unplaced; other shapes are skipped', () => {
    const r = surfacesFromMeasurements([item({
      payload: {
        unit: 'M',
        segments: [
          { shape: 'rect', mode: 'd', values: { a: 2.05, b: 2.55 } },
          { shape: 'tri', mode: 'bh', values: { b: 2, h: 1 } },
        ],
        openings: [{ w: 0.7, h: 2, n: 1 }],
      },
    })], ['m1']);
    expect(r.surfaces).toHaveLength(1);
    expect(r.surfaces[0]).toMatchObject({ name: 'Стіни · 1', width: 2050, height: 2550, floor: false });
    expect(r.unplaced).toEqual([{ w: 700, h: 2000 }]);
    expect(r.skipped).toBe(1);
  });

  it('only the elements the line points at', () => {
    expect(surfacesFromMeasurements([item({ id: 'other' })], ['m1']).surfaces).toEqual([]);
  });

  it('a legacy metre rectangle and a centimetre payload both read in mm', () => {
    const legacy = surfacesFromMeasurements([item({ payload: { segments: [{ l: 2, w: 1.5 }], openings: [] } })], ['m1']);
    expect(legacy.surfaces[0]).toMatchObject({ width: 2000, height: 1500 });
    const cm = surfacesFromMeasurements([item({
      name: 'Підлога',
      payload: { unit: 'CM', segments: [{ shape: 'rect', mode: 'd', values: { a: 205, b: 185 } }], openings: [] },
    })], ['m1']);
    expect(cm.surfaces[0]).toMatchObject({ width: 2050, height: 1850, floor: true });
  });
});

describe('the result', () => {
  it('one wall from the corner: the engine figures, spare once, the rest of the line by area', () => {
    const r = evaluate(draft({ surfaces: [{ ...wall('А', 1850, 2550), start: 'CORNER' }] }), 20);
    expect(r.minTiles).toBe(30);
    expect(r.maxTiles).toBe(36);
    expect(r.spare).toBe(2);
    // As measured: 1,85 × 2,55 = 4,7175 m², joints included — the figure an estimate line is written in.
    expect(r.laidArea).toBeCloseTo(4.718, 3);
    expect(r.rest).toBeCloseTo(15.282, 3);
    expect(r.byArea).toBe(29);
    expect(canSave(r)).toBe(true);
  });

  it('a switched-off surface is not counted; none at all cannot be saved', () => {
    const r = evaluate(draft({ surfaces: [{ ...wall('А', 1850, 2550), enabled: false }] }), 20);
    expect(r.laidArea).toBe(0);
    expect(canSave(r)).toBe(false);
  });

  it('a surface with an impossible figure blocks the save and names the field', () => {
    const r = evaluate(draft({ surfaces: [wall('А', 0, 2550), wall('Б', 1850, 2550)] }), 20);
    expect(r.surfaces[0].error).toBe('SURFACE');
    expect(canSave(r)).toBe(false);
  });

  it('more laid than the line by over 5 % is flagged', () => {
    expect(evaluate(draft(), 4).overLine).toBe(true);
    expect(evaluate(draft(), 4.6).overLine).toBe(false);
  });

  it('a symmetric start that cuts more than the corner says so', () => {
    const r = evaluate(draft({ surfaces: [{ ...wall('А', 1850, 2550), start: 'SYMMETRIC' }] }), 20);
    expect(r.surfaces[0].layout?.hints).toContain('MOSTLY_CUT');
    expect(r.surfaces[0].cornerCutsLess).toBe(true);
  });
});

describe('stored and back', () => {
  it('the request carries the format, the figures and the draft as JSON', () => {
    const d = draft();
    const r = evaluate(d, 20);
    const req = toRequest(d, r);
    expect(req).toMatchObject({ tileWidthMm: 300, tileHeightMm: 600, minTiles: r.minTiles, maxTiles: r.maxTiles, spare: 2 });
    expect(req).not.toHaveProperty('measurementsDeclined');
    const view: TileLayoutView = {
      estimateItemId: 'i', tileShortMm: 300, tileLongMm: 600, laidArea: req.laidArea, minTiles: req.minTiles,
      maxTiles: req.maxTiles, spare: req.spare, tilesToBuy: req.maxTiles + req.spare, paused: false,
      measurementsDeclined: false, params: req.params,
    };
    expect(fromStored(view)).toEqual(d);
  });

  it('a draft this build cannot read is not reopened', () => {
    const bad = { params: '{"version":2}' } as Pick<TileLayoutView, 'params'>;
    expect(fromStored({ ...({} as TileLayoutView), ...bad })).toBeNull();
    expect(fromStored({ ...({} as TileLayoutView), params: 'not json' })).toBeNull();
  });
});

describe('stage 4: the sizes into the measurements', () => {
  it('offered for typed sizes only, and only once', () => {
    expect(shouldOfferMeasurements(draft(), false)).toBe(true);
    expect(shouldOfferMeasurements(draft(), true)).toBe(false);
    expect(shouldOfferMeasurements(draft({ fromMeasurements: true }), false)).toBe(false);
    expect(shouldOfferMeasurements(draft({ savedToMeasurements: true }), false)).toBe(false);
    expect(shouldOfferMeasurements(draft({ surfaces: [wall('А')] }), false)).toBe(false);
  });

  it('the walls as one «Стіни» element with every opening, the floor as its own, in mm', () => {
    const d = draft({
      surfaces: [
        { ...wall('А', 2050, 2550), openings: [{ x: 1000, y: 0, w: 700, h: 2000 }] },
        wall('Б', 1850, 2550),
        { ...wall('Г', 1850, 2550), enabled: false },
        { ...wall('Підлога', 2050, 1850), floor: true },
      ],
    });
    const items = measurementItems(d, { walls: 'Стіни', floor: 'Підлога' });
    expect(items).toEqual([
      { name: 'Стіни', type: 'SURFACE', sortOrder: 0, payload: {
        unit: 'MM',
        segments: [
          { shape: 'rect', mode: 'd', values: { a: 2050, b: 2550 } },
          { shape: 'rect', mode: 'd', values: { a: 1850, b: 2550 } },
        ],
        openings: [{ w: 700, h: 2000, n: 1 }],
      } },
      { name: 'Підлога', type: 'SURFACE', sortOrder: 1, payload: {
        unit: 'MM', segments: [{ shape: 'rect', mode: 'd', values: { a: 2050, b: 1850 } }], openings: [],
      } },
    ]);
  });

  it('the flags survive a round trip, and the measured walls read back as surfaces', () => {
    const d = draft({ savedToMeasurements: true });
    const view = { params: JSON.stringify(d) } as TileLayoutView;
    expect(fromStored(view)?.savedToMeasurements).toBe(true);
    const back = surfacesFromMeasurements([{
      id: 'm', name: 'Стіни', type: 'SURFACE', unit: 'M2', result: 0, sortOrder: 0,
      payload: measurementItems(draft(), { walls: 'Стіни', floor: 'Підлога' })[0].payload,
    }], ['m']);
    expect(back.surfaces[0]).toMatchObject({ width: 1850, height: 2550 });
  });
});

describe('sizes are typed in metres', () => {
  it('reads metres with a comma or a point, and a number too big for metres as mm', () => {
    expect(sizeToMm('3,6')).toBe(3600);
    expect(sizeToMm('3.6')).toBe(3600);
    expect(sizeToMm(' 0,8 ')).toBe(800);
    expect(sizeToMm('20')).toBe(20000);
    expect(sizeToMm('3600')).toBe(3600);
    expect(sizeToMm('')).toBe(0);
    expect(sizeToMm('-1')).toBe(0);
    expect(readAsMm('3600')).toBe(true);
    expect(readAsMm('3,6')).toBe(false);
  });

  it('shows millimetres as metres, empty for nothing', () => {
    expect(mmToMetres(3600)).toBe('3,6');
    expect(mmToMetres(1850)).toBe('1,85');
    expect(mmToMetres(0)).toBe('');
  });
});

describe('a line names the surface it covers', () => {
  it('a floor by its words, a wall otherwise', () => {
    expect(lineIsFloor('Укладання плитки на підлогу 60×60')).toBe(true);
    expect(lineIsFloor('Облицювання сходинок плиткою')).toBe(true);
    expect(lineIsFloor('Облицювання стін плиткою 300×600')).toBe(false);
    expect(lineIsFloor('Укладання плитки 600х600')).toBe(false);
    expect(lineIsFloor('Плитка на стіни і підлогу')).toBe(false);
  });
});
