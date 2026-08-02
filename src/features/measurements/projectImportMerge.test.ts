import { describe, it, expect } from 'vitest';
import {
  buildPackage,
  checksum,
  crossCheck,
  elementPayloadV2,
  elementValue,
  mergeParses,
  perimeterFrom,
  roomItems,
  type MergedRoom,
  type PackageElement,
  type RoomInputs,
} from './projectImportMerge.ts';
import type { ProjectImportParseResponse } from '@/api/types.ts';

const empty: ProjectImportParseResponse = {
  floors: [], coverings: [], totalAreaM2: null, ceilingHeightsMm: {}, warnings: [],
};

const schedule = (floor: string | null): ProjectImportParseResponse => ({
  ...empty,
  totalAreaM2: 204,
  floors: [{
    floor: null, roomsOnThisSheet: [], // the schedule table itself never names the floor
    rooms: [
      { number: '4', name: 'Спальня', areaM2: 30, perimeterMm: null, wallSegmentsMm: null, widthMm: null, lengthMm: null, cutWidthMm: null, cutDepthMm: null, ceilingHmm: null, openings: [], confidence: 'high', note: null },
      { number: '5', name: 'Ванна', areaM2: 8, perimeterMm: null, wallSegmentsMm: null, widthMm: null, lengthMm: null, cutWidthMm: null, cutDepthMm: null, ceilingHmm: null, openings: [], confidence: 'high', note: null },
    ],
  }],
  ...(floor ? {} : {}),
});

const plan: ProjectImportParseResponse = {
  ...empty,
  floors: [{
    floor: '1 поверх',
    roomsOnThisSheet: [],
    rooms: [{
      number: '4', name: null, areaM2: null, perimeterMm: null,
      wallSegmentsMm: [5000, 6000, 5000, 6000],
      widthMm: null, lengthMm: null, cutWidthMm: null, cutDepthMm: null, ceilingHmm: null,
      openings: [
        { kind: 'вікно', wMm: 1400, hMm: 1500, sillMm: 900, note: null },
        { kind: 'двері', wMm: 900, hMm: 2100, sillMm: null, note: null },
      ],
      confidence: 'medium', note: null,
    }],
  }],
};

describe('mergeParses', () => {
  it('merges the schedule and the plan by room number; stamp floors normalise to the short label', () => {
    const m = mergeParses([
      { fileFloor: '1', resp: schedule('1') },
      { fileFloor: '1', resp: plan },
    ]);
    expect(m.rooms).toHaveLength(2);
    const bedroom = m.rooms.find((r) => r.number === '4')!;
    expect(bedroom.name).toBe('Спальня');
    // The plan's stamp «1 поверх» and the schedule file's «1п» land in ONE group.
    expect(bedroom.floor).toBe('1');
    expect(bedroom.areaM2).toBe(30);
    // No printed perimeter → OUR code sums the printed segments.
    expect(bedroom.perimeterMm).toBe(22000);
    expect(bedroom.perimeterDerived).toBe(true);
    expect(bedroom.openings).toHaveLength(2);
    expect(m.totalAreaM2).toBe(204);
  });

  it('falls back to the (normalised) sheet stamp floor when the filename gave none', () => {
    const m = mergeParses([{ fileFloor: null, resp: plan }]);
    expect(m.rooms[0].floor).toBe('1');
  });

  it('a floor in the ROOM NAME beats the file floor — one document holds both floors', () => {
    const both: ProjectImportParseResponse = {
      ...empty,
      floors: [{
        floor: null,
        roomsOnThisSheet: [],
        rooms: [
          { number: null, name: 'Коридор', areaM2: 12, perimeterMm: null, wallSegmentsMm: null, widthMm: null, lengthMm: null, cutWidthMm: null, cutDepthMm: null, ceilingHmm: null, openings: [], confidence: 'high', note: null },
          { number: null, name: 'Коридор 2 поверху', areaM2: 9, perimeterMm: null, wallSegmentsMm: null, widthMm: null, lengthMm: null, cutWidthMm: null, cutDepthMm: null, ceilingHmm: null, openings: [], confidence: 'high', note: null },
          { number: null, name: 'Мансарда', areaM2: 20, perimeterMm: null, wallSegmentsMm: null, widthMm: null, lengthMm: null, cutWidthMm: null, cutDepthMm: null, ceilingHmm: null, openings: [], confidence: 'high', note: null },
        ],
      }],
    };
    const m = mergeParses([{ fileFloor: '1', resp: both }]);
    expect(m.rooms.find((r) => r.name === 'Коридор')!.floor).toBe('1');           // file default
    expect(m.rooms.find((r) => r.name === 'Коридор 2 поверху')!.floor).toBe('2'); // room name wins
    expect(m.rooms.find((r) => r.name === 'Мансарда')!.floor).toBe('мансарда');
    // The name is NOT cleaned — the master recognises it as written.
    expect(m.rooms.some((r) => r.name === 'Коридор 2 поверху')).toBe(true);
  });
});

// The two-floor archive («Креслення друк.7z»): both «експлікація 1п» and «експлікація 2п»
// print the SAME 10-room table; only the numbers marked on each sheet differ.
describe('two floors, one identical schedule table on both sheets', () => {
  const table = (floorStamp: string, onSheet: string[]): ProjectImportParseResponse => ({
    ...empty,
    totalAreaM2: 204,
    floors: [{
      floor: floorStamp,
      roomsOnThisSheet: onSheet,
      rooms: [
        { number: '1', name: 'Коридор', areaM2: 26.5, perimeterMm: null, wallSegmentsMm: null, widthMm: null, lengthMm: null, cutWidthMm: null, cutDepthMm: null, ceilingHmm: null, openings: [], confidence: 'high', note: null },
        { number: '3', name: 'Кабінет', areaM2: 13.7, perimeterMm: null, wallSegmentsMm: null, widthMm: null, lengthMm: null, cutWidthMm: null, cutDepthMm: null, ceilingHmm: null, openings: [], confidence: 'high', note: null },
        { number: '7', name: 'Спальня', areaM2: 30.0, perimeterMm: null, wallSegmentsMm: null, widthMm: null, lengthMm: null, cutWidthMm: null, cutDepthMm: null, ceilingHmm: null, openings: [], confidence: 'high', note: null },
      ],
    }],
  });

  it('does NOT duplicate the rooms, and each lands on the floor whose sheet MARKS it', () => {
    const m = mergeParses([
      { fileFloor: '1', resp: table('1 поверх', ['1', '3']) },
      { fileFloor: '2', resp: table('2 поверх', ['7']) },
    ]);

    // 3 rooms, not 6 — the identical table is merged by number+name.
    expect(m.rooms).toHaveLength(3);
    expect(m.rooms.find((r) => r.number === '1')!.floor).toBe('1');
    expect(m.rooms.find((r) => r.number === '3')!.floor).toBe('1');
    expect(m.rooms.find((r) => r.number === '7')!.floor).toBe('2');
  });

  it('per-floor numbering stays apart — same number, different name = different rooms', () => {
    const floorOne: ProjectImportParseResponse = {
      ...empty,
      floors: [{ floor: '1 поверх', roomsOnThisSheet: ['1'], rooms: [
        { number: '1', name: 'Коридор', areaM2: 26.5, perimeterMm: null, wallSegmentsMm: null, widthMm: null, lengthMm: null, cutWidthMm: null, cutDepthMm: null, ceilingHmm: null, openings: [], confidence: 'high', note: null },
      ] }],
    };
    const floorTwo: ProjectImportParseResponse = {
      ...empty,
      floors: [{ floor: '2 поверх', roomsOnThisSheet: ['1'], rooms: [
        { number: '1', name: 'Спальня', areaM2: 30, perimeterMm: null, wallSegmentsMm: null, widthMm: null, lengthMm: null, cutWidthMm: null, cutDepthMm: null, ceilingHmm: null, openings: [], confidence: 'high', note: null },
      ] }],
    };
    const m = mergeParses([{ fileFloor: '1', resp: floorOne }, { fileFloor: '2', resp: floorTwo }]);
    expect(m.rooms).toHaveLength(2);
    expect(m.rooms.map((r) => r.floor).sort()).toEqual(['1', '2']);
  });

  it('name vs sheet conflict: keeps the NAME\'s floor and tells the master what the sheet said', () => {
    // Real case: «Коридор 2 поверху» is listed among floor 1's numbers (a double-height void).
    const resp: ProjectImportParseResponse = {
      ...empty,
      floors: [{ floor: '1 поверх', roomsOnThisSheet: ['2'], rooms: [
        { number: '2', name: 'Коридор 2 поверху', areaM2: 64.4, perimeterMm: null, wallSegmentsMm: null, widthMm: null, lengthMm: null, cutWidthMm: null, cutDepthMm: null, ceilingHmm: null, openings: [], confidence: 'high', note: null },
      ] }],
    };
    const room = mergeParses([{ fileFloor: '1', resp }]).rooms[0];
    expect(room.floor).toBe('2');                                   // the name wins
    expect(room.notes.some((n) => n.includes('на аркуші'))).toBe(true); // …but it's flagged
  });

  it('a room no sheet marks keeps no floor rather than a wrong one', () => {
    const m = mergeParses([{ fileFloor: '1', resp: table('1 поверх', ['1']) }]);
    expect(m.rooms.find((r) => r.number === '1')!.floor).toBe('1');
    expect(m.rooms.find((r) => r.number === '3')!.floor).toBeNull(); // not on this sheet
  });
});

// Numbers straight off Belgradska_1405.pdf p.3 — the file that exposed every bug.
describe('checksum — the proof that makes recognised sizes trustworthy', () => {
  it('accepts gabarits whose product matches the table area', () => {
    // «Кухня-вітальня 61,38 m²» = 13,3 × 4,615
    expect(checksum(61.38, 13300, 4615, null, null)).toEqual({ kind: 'rect' });
    // «Спальня 17,69 m²» = 4,99 × 3,545
    expect(checksum(17.69, 4990, 3545, null, null)).toEqual({ kind: 'rect' });
  });

  it('detects an L-shape when only area−cut matches (a proof, not a guess)', () => {
    // 5×4 = 20 ≠ 17 гросс, але 20 − 1,5×2 = 17 ✓
    expect(checksum(17, 5000, 4000, 1500, 2000)).toEqual({
      kind: 'lshape', cutWidthMm: 1500, cutDepthMm: 2000,
    });
  });

  it('rejects anything unproven — an unverified gabarit never reaches a calculation', () => {
    expect(checksum(17.69, 4990, 3200, null, null)).toEqual({ kind: 'reject' }); // 10% off
    expect(checksum(null, 4990, 3545, null, null)).toEqual({ kind: 'reject' });  // no table area
    expect(checksum(17.69, null, null, null, null)).toEqual({ kind: 'reject' }); // nothing read
  });

  it('merge: confirmed gabarits set an EXACT perimeter; rejected ones are kept as a hint only', () => {
    const withGabarits = (w: number, l: number): ProjectImportParseResponse => ({
      ...empty,
      floors: [{ floor: null, roomsOnThisSheet: [], rooms: [{
        number: '2', name: 'Спальня', areaM2: 17.69, perimeterMm: null, wallSegmentsMm: null,
        widthMm: w, lengthMm: l, cutWidthMm: null, cutDepthMm: null, ceilingHmm: 2850,
        openings: [], confidence: 'high', note: null,
      }] }],
    });

    const ok = mergeParses([{ fileFloor: null, resp: withGabarits(4990, 3545) }]).rooms[0];
    expect(ok.widthMm).toBe(4990);
    expect(ok.perimeterMm).toBe(2 * (4990 + 3545)); // 17070 mm
    expect(ok.perimeterDerived).toBe(false);
    expect(ok.rejected).toBeNull();
    expect(ok.ceilingHmm).toBe(2850); // «H=2850мм» from the plan

    const bad = mergeParses([{ fileFloor: null, resp: withGabarits(4990, 3200) }]).rooms[0];
    expect(bad.widthMm).toBeNull();           // not used in any calculation
    expect(bad.perimeterMm).toBeNull();
    expect(bad.rejected).toEqual({ widthMm: 4990, lengthMm: 3200 }); // shown greyed
  });

  it('NO table area → gabarits are accepted unverified, not thrown away', () => {
    // A room the schedule never listed (or whose row the model missed) still has its
    // dimension chains on the plan. The checksum has nothing to verify against — and
    // discarding the sizes then left the master with a room of zeros.
    const noArea: ProjectImportParseResponse = {
      ...empty,
      floors: [{ floor: null, roomsOnThisSheet: [], rooms: [{
        number: '7', name: 'Хол', areaM2: null, perimeterMm: null, wallSegmentsMm: null,
        widthMm: 5000, lengthMm: 4000, cutWidthMm: null, cutDepthMm: null, ceilingHmm: 2700,
        openings: [], confidence: 'high', note: null,
      }] }],
    };
    const room = mergeParses([{ fileFloor: null, resp: noArea }]).rooms[0];
    expect(room.widthMm).toBe(5000);
    expect(room.lengthMm).toBe(4000);
    expect(room.perimeterMm).toBe(2 * (5000 + 4000)); // walls + plinth can be computed
    expect(room.rejected).toBeNull();
    // …but the master is told they were not cross-checked.
    expect(room.confidence).toBe('medium');
    expect(room.notes.some((n) => n.includes('площі в таблиці немає'))).toBe(true);
  });
});

describe('an L-shaped room whose cut nobody transcribed', () => {
  // «1 Коридор 26,5 м²» from the Дубляни schedule: the corridor wraps a corner, so its bounding
  // box is far bigger than its area, and the plan prints no cut-out pair. This used to be thrown
  // away whole — and with it the walls, which were never wrong.
  const boxed: ProjectImportParseResponse = {
    ...empty,
    floors: [{
      floor: '1 поверх', roomsOnThisSheet: ['1'],
      rooms: [{
        number: '1', name: 'Коридор', areaM2: 26.5, perimeterMm: null, wallSegmentsMm: null,
        widthMm: 7547, lengthMm: 4460, cutWidthMm: null, cutDepthMm: null, ceilingHmm: null,
        openings: [], confidence: 'high', note: null,
      }],
    }],
  };

  it('keeps the gabarits for the WALLS and says which corner to check', () => {
    const room = mergeParses([{ fileFloor: '1', resp: boxed }]).rooms[0];

    // 7,547 × 4,460 = 33,66 m² against a printed 26,5 — not a rectangle, and not a misread either.
    expect(room.widthMm).toBe(7547);
    expect(room.lengthMm).toBe(4460);
    expect(room.rejected).toBeNull();
    // An L-shape's perimeter IS its bounding rectangle's — walls and plinth are exact.
    expect(room.perimeterMm).toBe(2 * (7547 + 4460));
    expect(room.boundingBoxOnly).toBe(true);
    expect(room.uncertain).toContain('cutWidthMm');
    expect(room.notes.some((n) => n.includes('Г-подібна'))).toBe(true);
    expect(room.confidence).toBe('medium');
  });

  it('the floor takes the SCHEDULE area, never the bounding rectangle', () => {
    const room = mergeParses([{ fileFloor: '1', resp: boxed }]).rooms[0];
    const pkg = buildPackage({
      areaM2: room.areaM2, widthMm: room.widthMm, lengthMm: room.lengthMm,
      perimeterMm: room.perimeterMm, heightMm: 2700, openings: room.openings,
      boundingBoxOnly: room.boundingBoxOnly,
    });

    const floor = pkg.find((e) => e.kind === 'floor')!;
    // No 7,5×4,5 rectangle: that would bill 33,66 m² of flooring for a 26,5 m² corridor.
    expect(floor.aMm).toBeNull();
    expect(floor.takeArea).toBe(true);
    expect(elementPayloadV2(floor)).toMatchObject({
      segments: [{ shape: 'direct', values: { s: 26.5 } }],
    });
    // …while a wall still gets the real run of the bounding box.
    expect(pkg.find((e) => e.key === 'wall-1')!.aMm).toBe(7547);
  });

  it('gabarits absurdly bigger than the area are still a misread, not a cut', () => {
    // A chain taken from the room next door: no niche removes 70% of a room. Note this one solves to
    // a perfectly tidy 1,35 m arm — arithmetic alone would wave it through, which is why the cut
    // fraction is checked as well as the shape.
    expect(checksum(26.5, 15000, 6000, null, null)).toEqual({ kind: 'reject' });
    // And smaller than the area is impossible for a bounding box — also a misread.
    expect(checksum(26.5, 3000, 3000, null, null)).toEqual({ kind: 'reject' });
    // An arm thinner than 600 mm is not a room that lost a corner either.
    expect(checksum(3, 4000, 3500, null, null)).toEqual({ kind: 'reject' });
  });

  it('keeps a Г-shaped corridor whose cut nobody transcribed', () => {
    // Дубляни, reported: the Г-shaped corridor came back with nothing. A 4,0 × 3,5 m box holding
    // 7,56 m² is an L with 1,2 m arms — a 46% cut, which the old 40% ceiling rejected outright,
    // throwing away walls that were correct. The perimeter of an L equals its bounding box's, so the
    // plinth, the reveals and the wall area are all right; only the floor is not, and the schedule
    // gives us that.
    expect(checksum(7.56, 4000, 3500, null, null)).toEqual({
      kind: 'bounding-box',
      missingAreaM2: 6.44,
    });
    // At the 900 mm minimum corridor width of ДБН В.2.2-15:2019 the cut reaches 58% — still kept.
    expect(checksum(5.94, 4000, 3500, null, null).kind).toBe('bounding-box');
    // And when the cut WAS transcribed it is a proof, not a fallback.
    expect(checksum(7.56, 4000, 3500, 2800, 2300)).toEqual({
      kind: 'lshape',
      cutWidthMm: 2800,
      cutDepthMm: 2300,
    });
  });
});

describe('crossCheck', () => {
  const rooms = (areas: number[]): MergedRoom[] =>
    areas.map((a, i) => ({
      key: String(i), number: null, name: 'К', floor: null, areaM2: a,
      perimeterMm: null, perimeterDerived: false, widthMm: null, lengthMm: null, cutWidthMm: null, cutDepthMm: null, rejected: null, boundingBoxOnly: false, ceilingHmm: null, openings: [], confidence: 'high', notes: [], uncertain: [],
    }));

  it('flags a >5% gap (rooms were lost) and passes a close match', () => {
    expect(crossCheck(rooms([100, 50]), 204)).toBe(150); // 26% off → flagged with the sum
    expect(crossCheck(rooms([102, 100]), 204)).toBeNull(); // ~1% → fine
    expect(crossCheck(rooms([100]), null)).toBeNull(); // no schedule total → nothing to check
  });
});

describe('buildPackage — the room package (v2: real per-wall geometry)', () => {
  const openings = [
    { kind: 'вікно', wMm: 1400, hMm: 1500, sillMm: 900, note: null },
    { kind: 'двері', wMm: 900, hMm: 2100, sillMm: null, note: null },
  ];
  const byKey = (els: PackageElement[]) => Object.fromEntries(els.map((e) => [e.key, e]));

  it('confirmed gabarits + height → real floor/ceiling rects and FOUR walls (2×w, 2×l)', () => {
    const els = buildPackage({
      areaM2: 30, widthMm: 5000, lengthMm: 6000, perimeterMm: 22000, heightMm: 2700, openings,
    });
    const by = byKey(els);
    // Floor is a real 5×6 rect, not a "direct area"; ceiling duplicates it but starts OFF.
    expect(by.floor).toMatchObject({ aMm: 5000, bMm: 6000, takeArea: false, enabled: true });
    expect(elementValue(by.floor)).toBe(30);
    expect(by.ceiling.enabled).toBe(false);
    // Four separate walls, each width×height / length×height.
    expect(els.filter((e) => e.kind === 'wall')).toHaveLength(4);
    expect(by['wall-1']).toMatchObject({ aMm: 5000, bMm: 2700, name: 'Стіна 1' });
    expect(by['wall-2']).toMatchObject({ aMm: 6000, bMm: 2700, name: 'Стіна 2' });
    // Only wall-1 carries the openings to subtract: 5×2.7 − (1.4×1.5 + 0.9×2.1) = 9.51.
    expect(elementValue(by['wall-1'])).toBe(9.51);
    expect(elementValue(by['wall-2'])).toBe(16.2);
    // Plinth = perimeter − doors; reveals = Σ(2h + w) per opening. Both as running metres.
    expect(elementValue(by.plinth)).toBe(21.1); // 22 − 0.9
    expect(elementValue(by.reveals)).toBe(9.5); // (2×1.5+1.4) + (2×2.1+0.9)
  });

  it('area only, no gabarits → floor imports EMPTY (never auto «площа напряму»); 4 empty walls', () => {
    const els = buildPackage({
      areaM2: 17.69, widthMm: null, lengthMm: null, perimeterMm: null, heightMm: 2850, openings: [],
    });
    const by = byKey(els);
    // No sizes read → EMPTY fields, NOT a taken area. The doc area waits in areaHintM2 as a
    // one-tap «взяти», and the element's value is 0 until the master measures or takes it.
    expect(by.floor).toMatchObject({ aMm: null, bMm: null, takeArea: false, areaHintM2: 17.69 });
    expect(elementValue(by.floor)).toBe(0);
    // Four walls exist but only the height is known — the run is left EMPTY, never a dead end.
    const walls = els.filter((e) => e.kind === 'wall');
    expect(walls).toHaveLength(4);
    expect(walls.every((w) => w.aMm === null && w.bMm === 2850)).toBe(true);
    expect(elementValue(walls[0])).toBe(0);
    // No perimeter → plinth/reveals have nothing to compute and start OFF.
    expect(by.plinth.enabled).toBe(false);
    expect(by.reveals.enabled).toBe(false);
  });

  it('gabarits but NO height → walls keep the run, wait on the height', () => {
    const els = buildPackage({
      areaM2: 30, widthMm: 5000, lengthMm: 6000, perimeterMm: 22000, heightMm: null, openings: [],
    });
    const walls = els.filter((e) => e.kind === 'wall');
    // Run is set, height missing — the review card flags exactly these as needing a height.
    expect(walls.every((w) => w.aMm != null && w.bMm === null)).toBe(true);
    expect(walls.every((w) => elementValue(w) === 0)).toBe(true);
    // The floor still computes, and the plinth still has its perimeter.
    expect(elementValue(byKey(els).floor)).toBe(30);
    expect(byKey(els).plinth.enabled).toBe(true);
  });

  it('a floor-reaching opening (toFloor) breaks the skirting; a window on a sill does not', () => {
    const base = { areaM2: 30, widthMm: 5000, lengthMm: 6000, perimeterMm: 22000, heightMm: 2700 };
    // A 2 m panoramic window to the floor + a 0.9 m door both cut the plinth.
    const toFloor = buildPackage({ ...base, openings: [
      { kind: 'вікно', wMm: 2000, hMm: 2400, sillMm: 0, toFloor: true, note: null },
      { kind: 'двері', wMm: 900, hMm: 2100, sillMm: null, note: null },
    ] });
    expect(elementValue(byKey(toFloor).plinth)).toBe(19.1); // 22 − 2 − 0.9
    // The same window on a sill (no toFloor) leaves the skirting running under it.
    const onSill = buildPackage({ ...base, openings: [
      { kind: 'вікно', wMm: 2000, hMm: 1500, sillMm: 900, note: null },
      { kind: 'двері', wMm: 900, hMm: 2100, sillMm: null, note: null },
    ] });
    expect(elementValue(byKey(onSill).plinth)).toBe(21.1); // 22 − 0.9 (door only)
  });

  it('sills element = Σ window widths, OFF by default, commits as a length-mode LINEAR', () => {
    const els = buildPackage({ areaM2: 30, widthMm: 5000, lengthMm: 6000, perimeterMm: 22000, heightMm: 2700, openings: [
      { kind: 'вікно', wMm: 1400, hMm: 1500, sillMm: 900, note: null },
      { kind: 'вікно', wMm: 1000, hMm: 1500, sillMm: 900, note: null },
      { kind: 'двері', wMm: 900, hMm: 2100, sillMm: null, note: null },
    ] });
    const sill = byKey(els).sill;
    expect(sill).toMatchObject({ kind: 'sill', name: 'Підвіконня', enabled: false });
    expect(elementValue(sill)).toBe(2.4); // 1.4 + 1.0 window widths (the door is not a sill)
    // Off by default → not committed; enabling it emits a length-mode LINEAR like the plinth.
    expect(roomItems(els).some((i) => i.name === 'Підвіконня')).toBe(false);
    expect(elementPayloadV2({ ...sill, enabled: true })).toEqual({
      height: 0, width: 2.4, sides: { left: false, right: false, top: true, bottom: false }, qty: 1, mode: 'length',
    });
  });
});

describe('perimeterFrom — the cascade that never dead-ends', () => {
  const base: RoomInputs = {
    areaM2: 17.69, widthMm: null, lengthMm: null, perimeterMm: null, heightMm: null, openings: [],
  };

  it('width alone gives length → perimeter (area ÷ width)', () => {
    expect(perimeterFrom({ ...base, widthMm: 4990 })).toBeCloseTo(2 * (4990 + 3545), 0);
  });

  it('confirmed gabarits give the exact perimeter; a printed one is used verbatim', () => {
    expect(perimeterFrom({ ...base, widthMm: 5000, lengthMm: 6000 })).toBe(22000);
    expect(perimeterFrom({ ...base, perimeterMm: 17070 })).toBe(17070);
  });
});

describe('elementValue / elementPayloadV2 / roomItems', () => {
  const el = (over: Partial<PackageElement>): PackageElement => ({
    key: 'x', kind: 'wall', name: 'X', unit: 'M2', enabled: true,
    aMm: null, bMm: null, areaHintM2: null, takeArea: false, lengthM: null, openings: [],
    ...over,
  });

  it('a blank floor reads 0, not its doc area — the area is a one-tap «взяти», never auto-shown', () => {
    expect(elementValue(el({ kind: 'floor', areaHintM2: 18.3, takeArea: false }))).toBe(0);
    // Taking it (the master's explicit choice) then uses the doc figure.
    expect(elementValue(el({ kind: 'floor', areaHintM2: 18.3, takeArea: true }))).toBe(18.3);
  });

  it('a surface commits as a real rect (a×b) with its openings subtracted client- and server-side', () => {
    expect(elementPayloadV2(el({
      kind: 'wall', aMm: 5000, bMm: 2700,
      openings: [{ kind: 'вікно', wMm: 1400, hMm: 1500, sillMm: 900, note: null }],
    }))).toEqual({
      unit: 'M',
      segments: [{ shape: 'rect', mode: 'd', values: { a: 5, b: 2.7 } }],
      openings: [{ w: 1.4, h: 1.5, n: 1 }],
    });
  });

  it('a taken floor area commits as a direct payload; plinth/reveals as a length-mode LINEAR', () => {
    expect(elementPayloadV2(el({ kind: 'floor', takeArea: true, areaHintM2: 18.3 }))).toEqual({
      unit: 'M', segments: [{ shape: 'direct', mode: 'd', values: { s: 18.3 } }], openings: [],
    });
    expect(elementPayloadV2(el({ kind: 'plinth', unit: 'LINEAR_METER', lengthM: 21.1 }))).toEqual({
      height: 0, width: 21.1, sides: { left: false, right: false, top: true, bottom: false }, qty: 1, mode: 'length',
    });
  });

  it('an empty SURFACE commits as an empty plane (skeleton to fill); an empty length commits nothing', () => {
    // A wall with no committable dimensions is NOT dropped — it becomes an empty plane
    // (segments: [] → server result 0) so the master gets the full 4-wall skeleton to fill in.
    expect(elementPayloadV2(el({ kind: 'wall', aMm: null, bMm: 2700 })))
      .toEqual({ unit: 'M', segments: [], openings: [] });
    // Plinth/reveals/sill with no length genuinely have nothing to commit.
    expect(elementPayloadV2(el({ kind: 'plinth', unit: 'LINEAR_METER', lengthM: null }))).toBeNull();
  });

  it('roomItems commits every enabled element (empty walls included), indexed by position', () => {
    const items = roomItems([
      el({ key: 'floor', kind: 'floor', name: 'Підлога', aMm: 5000, bMm: 6000 }),
      el({ key: 'wall-1', kind: 'wall', name: 'Стіна 1', aMm: 5000, bMm: 2700 }),
      el({ key: 'wall-2', kind: 'wall', name: 'Стіна 2', aMm: null, bMm: 2700 }), // empty → still kept
      el({ key: 'plinth', kind: 'plinth', name: 'Плінтус', unit: 'LINEAR_METER', lengthM: 21.1 }),
      el({ key: 'ceiling', kind: 'ceiling', name: 'Стеля', aMm: 5000, bMm: 6000, enabled: false }), // off → dropped
    ]);
    // The empty wall appears (skeleton), the disabled ceiling does not.
    expect(items.map((i) => i.name)).toEqual(['Підлога', 'Стіна 1', 'Стіна 2', 'Плінтус']);
    expect(items[2]).toMatchObject({ type: 'SURFACE', sortOrder: 2, payload: { segments: [] } });
    expect(items[3]).toMatchObject({ type: 'LINEAR', sortOrder: 3 }); // keeps its original index
  });
});
