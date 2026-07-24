import { describe, it, expect } from 'vitest';
import {
  checksum,
  crossCheck,
  deriveElements,
  deriveFromInputs,
  elementPayload,
  mergeParses,
  perimeterFrom,
  roomItems,
  wallBreakdown,
  type MergedRoom,
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
});

describe('crossCheck', () => {
  const rooms = (areas: number[]): MergedRoom[] =>
    areas.map((a, i) => ({
      key: String(i), number: null, name: 'К', floor: null, areaM2: a,
      perimeterMm: null, perimeterDerived: false, widthMm: null, lengthMm: null, cutWidthMm: null, cutDepthMm: null, rejected: null, ceilingHmm: null, openings: [], confidence: 'high', notes: [],
    }));

  it('flags a >5% gap (rooms were lost) and passes a close match', () => {
    expect(crossCheck(rooms([100, 50]), 204)).toBe(150); // 26% off → flagged with the sum
    expect(crossCheck(rooms([102, 100]), 204)).toBeNull(); // ~1% → fine
    expect(crossCheck(rooms([100]), null)).toBeNull(); // no schedule total → nothing to check
  });
});

describe('deriveElements — the room package', () => {
  const room: MergedRoom = {
    key: 'k', number: '4', name: 'Спальня', floor: '1',
    areaM2: 30, perimeterMm: 22000, perimeterDerived: true,
    widthMm: null, lengthMm: null, cutWidthMm: null, cutDepthMm: null, rejected: null, ceilingHmm: null,
    openings: [
      { kind: 'вікно', wMm: 1400, hMm: 1500, sillMm: 900, note: null },
      { kind: 'двері', wMm: 900, hMm: 2100, sillMm: null, note: null },
    ],
    confidence: 'high', notes: [],
  };

  it('derives the full package when perimeter AND height are known', () => {
    const { elements, missing } = deriveElements(room, 2700);
    const byKind = Object.fromEntries(elements.map((e) => [e.kind, e]));
    expect(byKind.floor.value).toBe(30);
    expect(byKind.ceiling.value).toBe(30);
    // 22×2.7 − (1.4×1.5 + 0.9×2.1) = 59.4 − 3.99
    expect(byKind.walls.value).toBe(55.41);
    // 22 − 0.9 (the door)
    expect(byKind.plinth.value).toBe(21.1);
    // Reveals for BOTH openings (2×h + w each): window 2×1.5+1.4 = 4.4, door 2×2.1+0.9 = 5.1
    expect(byKind.reveals.value).toBe(9.5);
    expect(missing).toHaveLength(0);
  });

  it('creates NO walls without a height, and says why', () => {
    const { elements, missing } = deriveElements(room, null);
    expect(elements.map((e) => e.kind)).toEqual(['floor', 'ceiling', 'plinth', 'reveals']);
    expect(missing).toEqual([{ kind: 'walls', reason: 'no-height' }]);
  });

  it('area-only room → floor+ceiling, walls/plinth marked as needing a perimeter', () => {
    const bare = { ...room, perimeterMm: null, openings: [] };
    const { elements, missing } = deriveElements(bare, 2700);
    expect(elements.map((e) => e.kind)).toEqual(['floor', 'ceiling']);
    expect(missing.map((m) => m.kind).sort()).toEqual(['plinth', 'walls']);
  });
});

describe('progressive card — the cascade that never dead-ends', () => {
  const base = {
    areaM2: 17.69, widthMm: null, lengthMm: null, perimeterMm: null,
    heightMm: null, openings: [],
  };

  it('width alone gives length → perimeter → (with a height) walls', () => {
    const widthOnly = { ...base, widthMm: 4990 };
    expect(perimeterFrom(widthOnly)).toBeCloseTo(2 * (4990 + 3545), 0); // area ÷ width

    const withHeight = { ...widthOnly, perimeterMm: perimeterFrom(widthOnly), heightMm: 2850 };
    const { elements, missing } = deriveFromInputs(withHeight);
    expect(missing).toHaveLength(0);
    expect(elements.find((e) => e.kind === 'walls')!.value).toBeCloseTo(48.65, 1);
  });

  it('shows the wall arithmetic and says out loud when openings are unknown', () => {
    const noOpenings = { ...base, perimeterMm: 17070, heightMm: 2850 };
    const w1 = wallBreakdown(noOpenings)!;
    expect(w1.grossM2).toBeCloseTo(48.65, 1);
    expect(w1.netM2).toBe(w1.grossM2);
    expect(w1.openingsUnknown).toBe(true);

    const w2 = wallBreakdown({
      ...noOpenings,
      openings: [{ kind: 'вікно', wMm: 1300, hMm: 1500, sillMm: 900, note: null }],
    })!;
    expect(w2.openingsM2).toBeCloseTo(1.95, 2);
    expect(w2.netM2).toBeCloseTo(w1.grossM2 - 1.95, 1);
    expect(w2.openingsUnknown).toBe(false);
  });
});

describe('roomItems / payloads', () => {
  it('applies the reserve and emits payloads the server recomputes identically', () => {
    const items = roomItems(
      [
        { kind: 'floor', value: 30, enabled: true },
        { kind: 'plinth', value: 20, enabled: true },
        { kind: 'walls', value: 50, enabled: false }, // unticked → dropped
      ],
      10,
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      name: 'Підлога', type: 'SURFACE',
      payload: { unit: 'M', segments: [{ shape: 'direct', mode: 'd', values: { s: 33 } }], openings: [] },
    });
    expect(items[1]).toMatchObject({
      name: 'Плінтус', type: 'LINEAR',
      payload: { width: 22, sides: { top: true, left: false, right: false, bottom: false }, qty: 1 },
    });
  });

  it('an edited value becomes a direct payload — what the master confirmed is what is computed', () => {
    // mode is a REAL variant key: '' used to leak into i18n lookups (shape.direct..hint).
    expect(elementPayload('walls', 48.5)).toEqual({
      unit: 'M', segments: [{ shape: 'direct', mode: 'd', values: { s: 48.5 } }], openings: [],
    });
  });
});
