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
  /** Per-room ceiling height from the plan's «H=…мм», mm. */
  ceilingHmm: number | null;
  openings: ProjectImportOpening[];
  confidence: Confidence;
  notes: string[];
}

/** Gabarits × vs the table area: the proof that makes recognised sizes trustworthy. */
export const CHECKSUM_TOLERANCE = 0.02;

export type ChecksumVerdict =
  | { kind: 'rect' }
  | { kind: 'lshape'; cutWidthMm: number; cutDepthMm: number }
  | { kind: 'reject' };

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
            ceilingHmm: null,
            openings: [],
            confidence: 'high',
            notes: [],
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
        if (r.areaM2 != null && room.areaM2 == null) room.areaM2 = r.areaM2;
        if (r.ceilingHmm != null && room.ceilingHmm == null) room.ceilingHmm = r.ceilingHmm;
        if (r.perimeterMm != null && room.perimeterMm == null) {
          room.perimeterMm = r.perimeterMm;
          room.perimeterDerived = false;
        }
        // Gabarits are only trusted once the checksum proves them against the table area.
        if (room.widthMm == null && r.widthMm != null && r.lengthMm != null) {
          const area = room.areaM2 ?? r.areaM2;
          const verdict = checksum(area, r.widthMm, r.lengthMm, r.cutWidthMm, r.cutDepthMm);
          if (verdict.kind === 'reject') {
            room.rejected = { widthMm: r.widthMm, lengthMm: r.lengthMm };
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
        if (r.openings.length > 0 && room.openings.length === 0) room.openings = r.openings;
        if (rank(r.confidence) > rank(room.confidence)) room.confidence = r.confidence;
        if (r.note && !room.notes.includes(r.note)) room.notes.push(r.note);
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

// ---- the element package ----------------------------------------------------

export type ElementKind = 'floor' | 'ceiling' | 'walls' | 'plinth' | 'reveals';

export interface ElementDraft {
  kind: ElementKind;
  /** Computed value in the element's unit (m² or м.пог) BEFORE the reserve. */
  value: number;
  unit: 'M2' | 'LINEAR_METER';
}

/** Why an element of the package could not be derived (review shows the reason). */
export interface MissingElement {
  kind: ElementKind;
  reason: 'no-area' | 'no-perimeter' | 'no-height';
}

/** The room's live numbers on the review card — recognised, computed or typed in. */
export interface RoomInputs {
  areaM2: number | null;
  widthMm: number | null;
  lengthMm: number | null;
  perimeterMm: number | null;
  heightMm: number | null;
  openings: ProjectImportOpening[];
}

/** Wall arithmetic laid open, so the card can show «брутто − прорізи = нетто». */
export interface WallBreakdown {
  grossM2: number;
  openingsM2: number;
  netM2: number;
  /** No openings known → the net IS the gross; the card must say so out loud. */
  openingsUnknown: boolean;
}

export function wallBreakdown(inputs: RoomInputs): WallBreakdown | null {
  if (inputs.perimeterMm == null || inputs.heightMm == null) return null;
  const gross = (inputs.perimeterMm / 1000) * (inputs.heightMm / 1000);
  const openingsM2 = inputs.openings.reduce((s, o) => s + (o.wMm / 1000) * (o.hMm / 1000), 0);
  return {
    grossM2: round3(gross),
    openingsM2: round3(openingsM2),
    netM2: round3(Math.max(0, gross - openingsM2)),
    openingsUnknown: inputs.openings.length === 0,
  };
}

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

export function deriveElements(
  room: MergedRoom,
  heightMm: number | null,
): { elements: ElementDraft[]; missing: MissingElement[] } {
  const inputs: RoomInputs = {
    areaM2: room.areaM2,
    widthMm: room.widthMm,
    lengthMm: room.lengthMm,
    perimeterMm: room.perimeterMm,
    // The plan's own «H=…мм» for this room wins over the per-floor answer.
    heightMm: room.ceilingHmm ?? heightMm,
    openings: room.openings,
  };
  return deriveFromInputs(inputs);
}

/** The single derivation used by both the first build and every live edit on the card. */
export function deriveFromInputs(
  inputs: RoomInputs,
): { elements: ElementDraft[]; missing: MissingElement[] } {
  const elements: ElementDraft[] = [];
  const missing: MissingElement[] = [];

  if (inputs.areaM2 != null) {
    elements.push({ kind: 'floor', value: round3(inputs.areaM2), unit: 'M2' });
    // Ceiling = a COPY of the floor for a rectangular room — a duplicate that used to
    // double every total. It's still derived (the review checkbox can enable it for
    // mansards etc.) but is OFF by default; the sheet controls the `enabled` flag.
    elements.push({ kind: 'ceiling', value: round3(inputs.areaM2), unit: 'M2' });
  } else {
    missing.push({ kind: 'floor', reason: 'no-area' });
  }

  const perimeterMm = perimeterFrom(inputs);
  const pM = perimeterMm != null ? perimeterMm / 1000 : null;
  const walls = wallBreakdown({ ...inputs, perimeterMm });
  if (walls) {
    elements.push({ kind: 'walls', value: walls.netM2, unit: 'M2' });
  } else {
    missing.push({ kind: 'walls', reason: pM == null ? 'no-perimeter' : 'no-height' });
  }

  if (pM != null) {
    const doorsM = inputs.openings
      .filter((o) => o.kind === 'двері')
      .reduce((s, o) => s + o.wMm / 1000, 0);
    elements.push({ kind: 'plinth', value: round3(Math.max(0, pM - doorsM)), unit: 'LINEAR_METER' });
  } else {
    missing.push({ kind: 'plinth', reason: 'no-perimeter' });
  }

  // Reveal run per opening: two heights + the top. A window's bottom is the sill, a
  // door's is the floor — neither is a reveal, so both are 2×h + w.
  if (inputs.openings.length > 0) {
    const run = inputs.openings.reduce((s, o) => s + 2 * (o.hMm / 1000) + o.wMm / 1000, 0);
    elements.push({ kind: 'reveals', value: round3(run), unit: 'LINEAR_METER' });
  }

  return { elements, missing };
}

/**
 * Payload for a (possibly master-edited) element value. Structured geometry is
 * NOT kept after an edit — an overridden number becomes a `direct`/length
 * payload, so what the master confirmed is exactly what the server computes.
 */
export function elementPayload(kind: ElementKind, value: number): SurfacePayload | LinearPayload {
  if (kind === 'floor' || kind === 'ceiling' || kind === 'walls') {
    // mode MUST be a real variant key ('d') — an empty string leaks into i18n keys
    // («shape.direct..hint») and breaks the shape editor's lookups.
    return { unit: 'M', segments: [{ shape: 'direct', mode: 'd', values: { s: round3(value) } }], openings: [] };
  }
  // Linear run: width carries the whole length, top side only → result = width.
  return {
    height: 0,
    width: round3(value),
    sides: { left: false, right: false, top: true, bottom: false },
    qty: 1,
  };
}

export const ELEMENT_NAMES: Record<ElementKind, string> = {
  floor: 'Підлога',
  ceiling: 'Стеля',
  walls: 'Стіни',
  plinth: 'Плінтус',
  reveals: 'Відкоси',
};

/** Commit items for one room: enabled elements with the reserve applied. */
export function roomItems(
  drafts: { kind: ElementKind; value: number; enabled: boolean }[],
  reservePct: number,
): MeasurementItemRequest[] {
  const f = 1 + Math.max(0, reservePct) / 100;
  return drafts
    .filter((d) => d.enabled && d.value > 0)
    .map((d, i) => ({
      name: ELEMENT_NAMES[d.kind],
      type: d.kind === 'plinth' || d.kind === 'reveals' ? 'LINEAR' as const : 'SURFACE' as const,
      payload: elementPayload(d.kind, round3(d.value * f)),
      sortOrder: i,
    }));
}
