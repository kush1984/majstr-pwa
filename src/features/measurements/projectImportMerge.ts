import type {
  Confidence,
  LinearPayload,
  MeasurementItemRequest,
  ProjectImportOpening,
  ProjectImportParseResponse,
  SurfacePayload,
} from '@/api/types.ts';
import type { ProjectImportCovering } from '@/api/types.ts';
import { floorFromName, floorFromRoomName } from '@/lib/projectDocs.ts';

/**
 * Pure logic of the project import: merging several parsed files into one room
 * list and deriving each room's measurement PACKAGE (floor/ceiling/walls/
 * skirting/reveals). The LLM only transcribed printed values — everything
 * computed here (and re-computed by the server from the payloads on commit).
 */

export interface MergedRoom {
  key: string;
  number: string | null;
  name: string;
  /** Room name first, then the sheet stamp, then the file's classified floor. */
  floor: string | null;
  areaM2: number | null;
  perimeterMm: number | null;
  /** True when the perimeter was summed from wall segments (not printed as one figure). */
  perimeterDerived: boolean;
  /** Gabarits read off the plan, mm — only set when the CHECKSUM confirmed them. */
  widthMm: number | null;
  lengthMm: number | null;
  /** Confirmed L-shape cut-out, mm (both set together with width/length). */
  cutWidthMm: number | null;
  cutDepthMm: number | null;
  /** Read but REJECTED by the checksum — shown greyed as a hint, never computed with. */
  rejected: { widthMm: number; lengthMm: number } | null;
  /**
   * The gabarits describe the room's BOUNDING BOX, not a rectangle it fills: walls and plinth use
   * them, the floor must not. Set when the printed area is smaller than w×l by a plausible cut.
   */
  boundingBoxOnly: boolean;
  /** Per-room ceiling height from the plan's «H=…мм», mm. */
  ceilingHmm: number | null;
  openings: ProjectImportOpening[];
  confidence: Confidence;
  notes: string[];
  /**
   * Field names the model read but could not confirm, unioned across every sheet that mentioned
   * this room. The review highlights exactly these — a figure the master can check in ten seconds
   * beats an empty field he has to re-derive from scratch.
   */
  uncertain: string[];
}

/** Gabarits × vs the table area: the proof that makes recognised sizes trustworthy. */
export const CHECKSUM_TOLERANCE = 0.02;

export type ChecksumVerdict =
  | { kind: 'rect' }
  | { kind: 'lshape'; cutWidthMm: number; cutDepthMm: number }
  /**
   * The gabarits are bigger than the printed area by a plausible cut-out, but the cut itself was
   * not read: an L-shaped room (or one with a niche) whose corner nobody transcribed.
   *
   * Rejecting this — which is what used to happen — threw away the whole geometry because ONE of
   * its uses was wrong. The perimeter of an L-shaped room equals the perimeter of its bounding
   * rectangle (the cut removes two segments and adds two identical ones), so the walls, the plinth
   * and the reveals are all correct from w×l. Only the FLOOR is not, and the floor is the one
   * figure the schedule already gives us.
   */
  | { kind: 'bounding-box'; missingAreaM2: number }
  | { kind: 'reject' };

/**
 * Above this, the "cut" is too big to be a cut: gabarits that exceed the area by more than this are
 * a misread chain, most often one belonging to the room next door.
 *
 * Raised from 0.4, which rejected the very shape it was written for. A corridor with 1,2 m arms in a
 * 4,0 × 3,5 m box holds 7,56 m², so its cut is 46 % of the box; at the 900 mm minimum corridor width
 * of ДБН В.2.2-15:2019 the same box gives 58 %. 0,6 covers a norm-minimum corridor and still refuses
 * the 70 % case that only a chain from the next room can produce.
 */
export const MAX_PLAUSIBLE_CUT = 0.6;

/**
 * Narrowest arm we will believe an L-shaped room has, in mm. Below this it is not a room that lost a
 * corner, it is a misread. Deliberately under the 900 mm the norm requires, because this tests
 * whether a shape is arithmetically possible, not whether it is compliant.
 */
export const MIN_ARM_MM = 600;

/**
 * The arm width an L-shape must have for this bounding box to enclose this area, in metres, or null
 * when no such shape exists.
 *
 * For a bounding box a×b with both arms w wide: `area = ab − (a−w)(b−w)`, which rearranges to
 * `w² − (a+b)w + area = 0`. The smaller root is the arm.
 *
 * This replaced a flat "gabarits may exceed the area by at most 40%" rule, which rejected the very
 * shape it was written for: a 4,0 × 3,5 m corridor with 1,2 m arms holds 7,56 m², so its cut is 46 %
 * of the box — over the old ceiling, and corridors are routinely narrower still. Solving for the arm
 * tests the same thing without a magic number: a plausible arm means the L is geometrically real,
 * and an absurd one (0,42 m for the same box holding 3 m²) means a chain was misread.
 */
export function impliedArmM(
  widthMm: number,
  lengthMm: number,
  areaM2: number,
): number | null {
  const a = widthMm / 1000;
  const b = lengthMm / 1000;
  const disc = (a + b) * (a + b) - 4 * areaM2;
  if (disc < 0) return null; // no real shape: the box cannot hold that area with a corner removed
  const w = (a + b - Math.sqrt(disc)) / 2;
  return w > 0 && w < Math.min(a, b) ? w : null;
}

/**
 * width × length must equal the table area (±2%). If it doesn't, but
 * width × length − cut equals it, the room is L-shaped — that's a PROOF, not a
 * guess, so the shape can be proposed with confidence. Anything else is rejected:
 * an unverified gabarit never reaches a calculation.
 */
export function checksum(
  areaM2: number | null,
  widthMm: number | null,
  lengthMm: number | null,
  cutWidthMm: number | null,
  cutDepthMm: number | null,
): ChecksumVerdict {
  if (areaM2 == null || areaM2 <= 0 || !widthMm || !lengthMm) return { kind: 'reject' };
  const gross = (widthMm / 1000) * (lengthMm / 1000);
  if (Math.abs(gross - areaM2) / areaM2 <= CHECKSUM_TOLERANCE) return { kind: 'rect' };
  if (cutWidthMm && cutDepthMm) {
    const net = gross - (cutWidthMm / 1000) * (cutDepthMm / 1000);
    if (net > 0 && Math.abs(net - areaM2) / areaM2 <= CHECKSUM_TOLERANCE) {
      return { kind: 'lshape', cutWidthMm, cutDepthMm };
    }
  }
  // Bigger than the area, and a corner cut of a believable width explains the difference: the shape
  // is not a plain rectangle and the cut was not transcribed. Keep what is usable — the perimeter of
  // an L-shape IS its bounding box's — instead of discarding all of it.
  // Two conditions, because either alone lets a misread through. The fraction bounds how much of a
  // box a cut may take; the implied arm checks that a cut of that size is a SHAPE rather than
  // arithmetic — a 15,0 × 6,0 box over 26,5 m² solves to a tidy 1,35 m arm and is still a chain
  // borrowed from the room next door.
  const excess = gross - areaM2;
  if (excess > 0 && excess / gross <= MAX_PLAUSIBLE_CUT) {
    const arm = impliedArmM(widthMm, lengthMm, areaM2);
    if (arm != null && arm * 1000 >= MIN_ARM_MM) {
      return { kind: 'bounding-box', missingAreaM2: round3(excess) };
    }
  }
  return { kind: 'reject' };
}

export interface MergedImport {
  rooms: MergedRoom[];
  coverings: ProjectImportCovering[];
  totalAreaM2: number | null;
  /** floor label → absolute ceiling height, mm (master fills the gaps). */
  ceilingHeightsMm: Record<string, number>;
  warnings: string[];
}

interface ParsedFile {
  fileFloor: string | null;
  resp: ProjectImportParseResponse;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function mergeParses(parses: ParsedFile[]): MergedImport {
  const rooms = new Map<string, MergedRoom>();
  const coverings: ProjectImportCovering[] = [];
  const heights: Record<string, number> = {};
  const warnings: string[] = [];
  let totalAreaM2: number | null = null;
  let unnamed = 0;

  for (const { fileFloor, resp } of parses) {
    for (const floorEntry of resp.floors) {
      const sheetFloor = stampFloor(floorEntry.floor) ?? fileFloor;
      const onSheet = (floorEntry.roomsOnThisSheet ?? []).map((n) => n.trim());
      for (const r of floorEntry.rooms) {
        const number = r.number?.trim() || null;
        const name = r.name?.trim() || null;
        const nameFloor = name ? floorFromRoomName(name) : null;
        // Which floor this SHEET claims for this room. A schedule table is routinely
        // printed identically on every sheet, so the table alone proves nothing — only
        // the numbers actually marked on the sheet do. When the sheet lists its rooms
        // and this one isn't among them, the sheet says NOTHING about it (null).
        const sheetClaim = onSheet.length > 0
          ? (number && onSheet.includes(number) ? sheetFloor : null)
          : sheetFloor;
        // The room's own name wins («Коридор 2 поверху»); the sheet is the fallback.
        const floor = nameFloor ?? sheetClaim;
        // Key by number+name, NOT by floor: the same room arriving from two sheets must
        // merge (identical tables), while per-floor numbering («№1» on both floors with
        // different names) still stays apart. A plan usually gives only the NUMBER and the
        // schedule only the NAME, so a nameless arrival joins the room with that number.
        const key = resolveKey(rooms, number, name);
        let room = rooms.get(key);
        if (!room) {
          room = {
            key,
            number,
            name: name ?? `Приміщення ${++unnamed}`,
            floor,
            areaM2: null,
            perimeterMm: null,
            perimeterDerived: false,
            widthMm: null,
            lengthMm: null,
            cutWidthMm: null,
            cutDepthMm: null,
            rejected: null,
            boundingBoxOnly: false,
            ceilingHmm: null,
            openings: [],
            confidence: 'high',
            notes: [],
            uncertain: [],
          };
          rooms.set(key, room);
        }
        if (name && room.name.startsWith('Приміщення ')) room.name = name;
        // A later sheet may be the one that actually claims this room.
        if (room.floor == null && floor != null) room.floor = floor;
        // Name and sheet disagree → we do NOT guess: keep the name's floor (the master's
        // own words) and SAY that the sheet drew it elsewhere, so it can be corrected.
        if (nameFloor != null && sheetClaim != null && nameFloor !== sheetClaim) {
          const note = `на аркуші «${sheetClaim}» поверху — перевірте`;
          if (!room.notes.includes(note)) room.notes.push(note);
        }
        if (r.areaM2 != null && room.areaM2 == null) {
          room.areaM2 = r.areaM2;
          room.uncertain = room.uncertain.filter((f) => f !== 'areaM2');
        }
        if (r.ceilingHmm != null && room.ceilingHmm == null) {
          room.ceilingHmm = r.ceilingHmm;
          room.uncertain = room.uncertain.filter((f) => f !== 'ceilingHmm');
        }
        if (r.perimeterMm != null && room.perimeterMm == null) {
          room.perimeterMm = r.perimeterMm;
          room.perimeterDerived = false;
        }
        // Gabarits are verified against the table area when there IS one. When the room has
        // no table area, the checksum has nothing to verify against — and throwing the sizes
        // away then is wrong: the gabarits ARE the room (its area follows from w×l). So they
        // are accepted unverified, and the room is flagged so the review shows it.
        if (room.widthMm == null && r.widthMm != null && r.lengthMm != null) {
          const area = room.areaM2 ?? r.areaM2;
          const verdict: ChecksumVerdict = area == null
            ? { kind: 'rect' }
            : checksum(area, r.widthMm, r.lengthMm, r.cutWidthMm, r.cutDepthMm);
          if (area == null) {
            const note = 'розміри з креслення (площі в таблиці немає) — звірте';
            if (!room.notes.includes(note)) room.notes.push(note);
            if (rank('medium') > rank(room.confidence)) room.confidence = 'medium';
          }
          if (verdict.kind === 'reject') {
            room.rejected = { widthMm: r.widthMm, lengthMm: r.lengthMm };
          } else if (verdict.kind === 'bounding-box') {
            // Walls/plinth/reveals are right from the bounding box; the floor comes from the
            // schedule area instead, and the master is told which corner to check.
            room.widthMm = r.widthMm;
            room.lengthMm = r.lengthMm;
            room.perimeterMm = 2 * (r.widthMm + r.lengthMm);
            room.perimeterDerived = false;
            room.boundingBoxOnly = true;
            if (!room.uncertain.includes('cutWidthMm')) room.uncertain.push('cutWidthMm');
            const note = `габарити ${(r.widthMm / 1000).toLocaleString('uk-UA')}×`
              + `${(r.lengthMm / 1000).toLocaleString('uk-UA')} м більші за площу на `
              + `${verdict.missingAreaM2.toLocaleString('uk-UA')} м² — схоже на виріз (Г-подібна), уточніть`;
            if (!room.notes.includes(note)) room.notes.push(note);
            if (rank('medium') > rank(room.confidence)) room.confidence = 'medium';
          } else {
            room.widthMm = r.widthMm;
            room.lengthMm = r.lengthMm;
            if (verdict.kind === 'lshape') {
              room.cutWidthMm = verdict.cutWidthMm;
              room.cutDepthMm = verdict.cutDepthMm;
            }
            // Gabarits confirmed → the perimeter is exact (an L-shape's equals its
            // bounding rectangle: the cut removes two segments and adds two identical).
            room.perimeterMm = 2 * (r.widthMm + r.lengthMm);
            room.perimeterDerived = false;
          }
        }
        // No printed perimeter — OUR code may sum the printed wall segments (the LLM must not).
        if (room.perimeterMm == null && r.wallSegmentsMm && r.wallSegmentsMm.length >= 3) {
          room.perimeterMm = r.wallSegmentsMm.reduce((s, v) => s + v, 0);
          room.perimeterDerived = true;
        }
        // UNION, not first-wins: on a real set the windows are specified on one sheet and the
        // doors on another, and taking only the first sheet that had any silently loses the rest.
        for (const opening of r.openings) {
          const key = `${opening.kind}|${opening.wMm}|${opening.hMm}`;
          if (!room.openings.some((o) => `${o.kind}|${o.wMm}|${o.hMm}` === key)) {
            room.openings.push(opening);
          }
        }
        if (rank(r.confidence) > rank(room.confidence)) room.confidence = r.confidence;
        if (r.note && !room.notes.includes(r.note)) room.notes.push(r.note);
        // Union, never replace: one sheet may confirm what another could not, but until some sheet
        // actually SUPPLIES the figure the doubt stands. Fields we then fill from elsewhere are
        // cleared below, where they are filled.
        for (const field of r.uncertain ?? []) {
          if (!room.uncertain.includes(field)) room.uncertain.push(field);
        }
      }
    }
    coverings.push(...resp.coverings);
    for (const [floor, mm] of Object.entries(resp.ceilingHeightsMm)) {
      const label = fileFloor ?? floor;
      if (!(label in heights)) heights[label] = mm;
    }
    if (resp.totalAreaM2 != null && totalAreaM2 == null) totalAreaM2 = resp.totalAreaM2;
    for (const w of resp.warnings) {
      if (!warnings.includes(w)) warnings.push(w);
    }
  }
  return { rooms: [...rooms.values()], coverings, totalAreaM2, ceilingHeightsMm: heights, warnings };
}

/**
 * The merge key for one parsed room. Same number + same name → one room. A room that
 * carries only a number (the plan) joins the one the schedule named; two rooms with the
 * same number but DIFFERENT names stay apart (projects that number per floor).
 */
function resolveKey(
  rooms: Map<string, MergedRoom>,
  number: string | null,
  name: string | null,
): string {
  const lower = (name ?? '').toLowerCase();
  if (!number) return lower;
  const exact = `#${number}|${lower}`;
  if (rooms.has(exact)) return exact;
  for (const [key, room] of rooms) {
    if (room.number !== number) continue;
    const known = room.name.toLowerCase();
    // One side is unnamed (or auto-named) → they're the same room seen from two sheets.
    if (!lower || room.name.startsWith('Приміщення ') || known === lower) return key;
  }
  return exact;
}

const rank = (c: Confidence) => (c === 'low' ? 2 : c === 'medium' ? 1 : 0);

/** Sheet-stamp floor («Обмірний план 1 поверх») → the canonical short label («1»),
 *  so stamp- and filename-derived floors land in ONE group. */
function stampFloor(raw: string | null): string | null {
  const s = raw?.trim() || null;
  if (!s) return null;
  return floorFromName(s) ?? s;
}

/**
 * Cross-check: recognised room areas vs the schedule's «Загальна площа».
 * A >5% gap usually means rooms were LOST in recognition — surface it loudly.
 */
export function crossCheck(rooms: MergedRoom[], totalAreaM2: number | null): number | null {
  if (totalAreaM2 == null || totalAreaM2 <= 0) return null;
  const sum = rooms.reduce((s, r) => s + (r.areaM2 ?? 0), 0);
  const diff = Math.abs(sum - totalAreaM2) / totalAreaM2;
  return diff > 0.05 ? round3(sum) : null;
}

// ---- the element package (v2: real geometry, per-wall) ----------------------

export type ElementKind = 'floor' | 'ceiling' | 'wall' | 'plinth' | 'reveals' | 'sill';

/** Running-length elements (м.пог) — a plain length, not an area. */
const LINEAR_KINDS: ReadonlySet<ElementKind> = new Set(['plinth', 'reveals', 'sill']);
export const isLinearKind = (kind: ElementKind): boolean => LINEAR_KINDS.has(kind);

/** The room's parsed numbers — the seed the package is built from once. */
export interface RoomInputs {
  areaM2: number | null;
  widthMm: number | null;
  lengthMm: number | null;
  perimeterMm: number | null;
  heightMm: number | null;
  openings: ProjectImportOpening[];
  /** Gabarits are the room's BOUNDING BOX (an unread cut-out): walls yes, floor no. */
  boundingBoxOnly?: boolean;
}

/**
 * One element of a room's package. Surfaces (floor / ceiling / each wall) carry a REAL
 * rect {@link aMm}×{@link bMm} so the master edits actual dimensions on site — never a
 * "direct area". A floor/ceiling whose gabarits weren't read keeps the doc AREA as a hint
 * ({@link areaHintM2}) that fills in one tap. Plinth/reveals are a plain running length.
 */
export interface PackageElement {
  key: string;
  kind: ElementKind;
  name: string;
  unit: 'M2' | 'LINEAR_METER';
  enabled: boolean;
  /** Surface rect (mm). Null side = to be measured. Floor: a=width,b=length. Wall: a=run,b=height. */
  aMm: number | null;
  bMm: number | null;
  /** Floor/ceiling only: the doc area (m²), shown as a hint + a one-tap fill. */
  areaHintM2: number | null;
  /** Floor/ceiling: commit the area hint as a `direct` payload instead of the rect. */
  takeArea: boolean;
  /** Plinth/reveals: running length (m). */
  lengthM: number | null;
  /** Only wall-1 carries the openings to subtract. */
  openings: ProjectImportOpening[];
}

export const ELEMENT_NAMES: Record<ElementKind, string> = {
  floor: 'Підлога',
  ceiling: 'Стеля',
  wall: 'Стіна',
  plinth: 'Плінтус',
  reveals: 'Відкоси',
  sill: 'Підвіконня',
};

/** Perimeter from whatever is known: gabarits → 2(w+l); else area ÷ width → 2(w+l). */
export function perimeterFrom(inputs: RoomInputs): number | null {
  if (inputs.widthMm != null && inputs.lengthMm != null) {
    return 2 * (inputs.widthMm + inputs.lengthMm);
  }
  if (inputs.widthMm != null && inputs.areaM2 != null && inputs.widthMm > 0) {
    const lengthMm = (inputs.areaM2 * 1_000_000) / inputs.widthMm;
    return 2 * (inputs.widthMm + lengthMm);
  }
  return inputs.perimeterMm;
}

/** Computed area/length of an element in its unit (0 = still needs input — never a guess). */
export function elementValue(el: PackageElement): number {
  if (isLinearKind(el.kind)) return round3(Math.max(0, el.lengthM ?? 0));
  // Only a taken area (the master's explicit one-tap choice) uses the doc figure directly.
  if (el.takeArea && el.areaHintM2 != null) return round3(el.areaHintM2);
  if (el.aMm != null && el.bMm != null) {
    const gross = (el.aMm / 1000) * (el.bMm / 1000);
    const openings = el.openings.reduce((s, o) => s + (o.wMm / 1000) * (o.hMm / 1000), 0);
    return round3(Math.max(0, gross - openings));
  }
  // Empty by default — the doc area lives in `areaHintM2` and is offered as a one-tap «взяти»,
  // never shown as the element's value (that read as a locked «площа напряму»).
  return 0;
}

/**
 * Build a room's package ONCE from its parsed numbers. Every surface is a real rect;
 * walls are FOUR (2×width, 2×length, each × height) from confirmed gabarits, or four
 * empty walls (height filled where known) to measure on site. After this, the master
 * edits each element's dimensions independently on the review card.
 */
export function buildPackage(inputs: RoomInputs): PackageElement[] {
  const h = inputs.heightMm;
  const w = inputs.widthMm;
  const l = inputs.lengthMm;
  const hasGabarits = w != null && l != null;
  const els: PackageElement[] = [];

  // An L-shaped room's gabarits describe the box it sits in, so a rect floor of w×l would
  // overstate it by the cut. The schedule's own area is the honest figure — take it, rather than
  // offer a rectangle we already know is wrong.
  const boxOnly = inputs.boundingBoxOnly === true;
  const floorCeil = (kind: 'floor' | 'ceiling', enabled: boolean): PackageElement => ({
    key: kind, kind, name: ELEMENT_NAMES[kind], unit: 'M2', enabled,
    aMm: hasGabarits && !boxOnly ? w : null,
    bMm: hasGabarits && !boxOnly ? l : null,
    areaHintM2: inputs.areaM2,
    // NEVER auto-take the area — a floor with no gabarits imports with EMPTY width×length
    // fields (the master measures), and the doc area is offered as a one-tap «взяти площу»
    // hint. Defaulting to "take" produced a locked «площа напряму», which is not what we want.
    // The exception is the bounding-box case above: there the rectangle is known to be wrong and
    // the area is known to be right, so leaving it untaken would only invite a worse answer.
    takeArea: boxOnly && inputs.areaM2 != null && inputs.areaM2 > 0,
    lengthM: null, openings: [],
  });
  els.push(floorCeil('floor', true));
  // Ceiling starts OFF — for a rectangular room it duplicates the floor.
  els.push(floorCeil('ceiling', false));

  const runs: (number | null)[] = hasGabarits ? [w, l, w, l] : [null, null, null, null];
  runs.forEach((run, i) => {
    els.push({
      key: `wall-${i + 1}`, kind: 'wall', name: `${ELEMENT_NAMES.wall} ${i + 1}`, unit: 'M2',
      enabled: true, aMm: run, bMm: h, areaHintM2: null, takeArea: false, lengthM: null,
      openings: i === 0 ? inputs.openings : [],
    });
  });

  const per = perimeterFrom(inputs);
  // Any opening that reaches the floor breaks the skirting — doors, open passages and
  // floor-to-ceiling/panoramic windows (the `toFloor` flag); a door is always floor-reaching
  // even on an older payload with no flag.
  const toFloorM = inputs.openings
    .filter((o) => o.toFloor ?? o.kind === 'двері')
    .reduce((s, o) => s + o.wMm / 1000, 0);
  const plinthM = per != null ? Math.max(0, per / 1000 - toFloorM) : null;
  els.push({
    key: 'plinth', kind: 'plinth', name: ELEMENT_NAMES.plinth, unit: 'LINEAR_METER',
    enabled: plinthM != null && plinthM > 0, aMm: null, bMm: null, areaHintM2: null, takeArea: false,
    lengthM: plinthM, openings: [],
  });

  // Reveal run per opening: 2×height + width (window sill and door threshold aren't reveals).
  const revealsM = inputs.openings.length
    ? inputs.openings.reduce((s, o) => s + 2 * (o.hMm / 1000) + o.wMm / 1000, 0)
    : null;
  els.push({
    key: 'reveals', kind: 'reveals', name: ELEMENT_NAMES.reveals, unit: 'LINEAR_METER',
    enabled: revealsM != null && revealsM > 0, aMm: null, bMm: null, areaHintM2: null, takeArea: false,
    lengthM: revealsM, openings: [],
  });

  // Window sills (підвіконня) = Σ window widths. OFF by default — only some trades finish/fit
  // sills — but seeded so a one-tap enable already carries the running length.
  const windowsM = inputs.openings
    .filter((o) => o.kind === 'вікно')
    .reduce((s, o) => s + o.wMm / 1000, 0);
  els.push({
    key: 'sill', kind: 'sill', name: ELEMENT_NAMES.sill, unit: 'LINEAR_METER',
    enabled: false, aMm: null, bMm: null, areaHintM2: null, takeArea: false,
    lengthM: windowsM > 0 ? windowsM : null, openings: [],
  });

  return els;
}

/** The room's package, seeded once from its parsed numbers. */
export function buildRoomPackage(room: MergedRoom, floorHeightMm: number | null): PackageElement[] {
  return buildPackage({
    areaM2: room.areaM2,
    widthMm: room.widthMm,
    lengthMm: room.lengthMm,
    perimeterMm: room.perimeterMm,
    // The plan's own «H=…мм» for this room wins over the per-floor answer.
    heightMm: room.ceilingHmm ?? floorHeightMm,
    openings: room.openings,
    boundingBoxOnly: room.boundingBoxOnly,
  });
}

/**
 * The commit payload for one element — REAL geometry the master keeps editing:
 * a surface is a `rect` (a×b, mm→m); a floor/ceiling whose area the master TOOK becomes
 * `direct`; plinth/reveals a length-mode LINEAR. A surface with nothing measured yet
 * commits as an EMPTY plane (`segments: []` → result 0) so the master still gets the whole
 * skeleton (all 4 walls, floor) to fill in on site — never dropped, never a guessed value.
 */
export function elementPayloadV2(el: PackageElement): SurfacePayload | LinearPayload | null {
  if (isLinearKind(el.kind)) {
    const m = el.lengthM ?? 0;
    if (m <= 0) return null;
    return { height: 0, width: round3(m), sides: { left: false, right: false, top: true, bottom: false }, qty: 1, mode: 'length' };
  }
  if (el.aMm != null && el.bMm != null && el.aMm > 0 && el.bMm > 0) {
    return {
      unit: 'M',
      segments: [{ shape: 'rect', mode: 'd', values: { a: round3(el.aMm / 1000), b: round3(el.bMm / 1000) } }],
      openings: el.openings.map((o) => ({ w: round3(o.wMm / 1000), h: round3(o.hMm / 1000), n: 1 })),
    };
  }
  if ((el.kind === 'floor' || el.kind === 'ceiling') && el.takeArea && el.areaHintM2 != null && el.areaHintM2 > 0) {
    return { unit: 'M', segments: [{ shape: 'direct', mode: 'd', values: { s: round3(el.areaHintM2) } }], openings: [] };
  }
  // Enabled surface with no committable dimensions yet → an empty plane the master fills in.
  return { unit: 'M', segments: [], openings: [] };
}

/** Commit items for one room: enabled elements that resolve to a payload. */
export function roomItems(elements: PackageElement[]): MeasurementItemRequest[] {
  const out: MeasurementItemRequest[] = [];
  elements.forEach((el, i) => {
    if (!el.enabled) return;
    const payload = elementPayloadV2(el);
    if (!payload) return;
    out.push({
      name: el.name,
      type: isLinearKind(el.kind) ? 'LINEAR' : 'SURFACE',
      payload: payload,
      sortOrder: i,
    });
  });
  return out;
}
