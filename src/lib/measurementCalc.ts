import {
  LENGTH_FACTOR, planeFromLegacy, planesAreaM2, type LengthUnit, type Plane,
} from '@/lib/shapes.ts';
import type {
  LinearPayload, MeasurementItem, MeasurementPayload, MeasurementRoom, MeasurementsResponse,
  MeasurementType, PartitionPayload, PointsPayload, ShtrobaPayload, SurfacePayload, Unit,
} from '@/api/types.ts';

/**
 * Client-side mirror of the backend `MeasurementCalc` — the ONE place the PWA computes a
 * measurement's result. The server stays authoritative (it recomputes on save); this exists so an
 * element authored OFFLINE shows the right number immediately, and so the editor and the offline
 * tree can't drift apart with two copies of the arithmetic.
 *
 * Every formula here matches the Java side one-for-one; a change there must be mirrored here.
 */

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
/** Non-negative, 3 decimals — and NEVER NaN: `Math.max(0, NaN)` is NaN, and a NaN quantity would
 *  ride into an estimate line as money. A garbage input reads as "unmeasured", i.e. 0. */
const clamp = (n: number): number => (Number.isFinite(n) ? round3(Math.max(0, n)) : 0);
const posInt = (n: number | undefined): number => Math.max(0, Math.round(n ?? 0));

/** Each type has ONE fixed unit — substitution into estimate lines works purely by unit. */
export function unitForType(type: MeasurementType): Unit {
  switch (type) {
    case 'ELECTRICAL_POINTS': return 'PIECE';
    case 'LINEAR':
    case 'SHTROBA': return 'LINEAR_METER';
    case 'CABLE': return 'M';
    default: return 'M2'; // SURFACE, PARTITION
  }
}

/** Σ planes − Σ openings, in m². Legacy `{l, w}` segments are pre-shapes rectangles in metres. */
function surface(p: SurfacePayload): number {
  const unit: LengthUnit = p.unit ?? 'M';
  const planes: Plane[] = (p.segments ?? []).map((s) =>
    s.shape
      ? { shape: s.shape, mode: s.mode ?? 'd', values: s.values ?? {} }
      : planeFromLegacy(s.l ?? 0, s.w ?? 0));
  const f = LENGTH_FACTOR[unit] ?? 1;
  const openings = (p.openings ?? []).reduce(
    (sum, o) => sum + (o.w ?? 0) * (o.h ?? 0) * Math.max(1, posInt(o.n)) * f * f, 0);
  return clamp(planesAreaM2(planes, unit) - openings);
}

/** HW·left + HW·right + HD·end + WD·top — the obscured faces of a partition/box. */
function partition(p: PartitionPayload): number {
  const { height: h = 0, width: w = 0, depth: d = 0 } = p;
  const f = p.faces ?? { left: true, right: true, end: true, top: false };
  let r = 0;
  if (f.left) r += h * w;
  if (f.right) r += h * w;
  if (f.end) r += h * d;
  if (f.top) r += w * d;
  return clamp(r);
}

/** (H·left + H·right + W·top + W·bottom) · qty — reveal/skirting perimeter × count. */
function linear(p: LinearPayload): number {
  const { height: h = 0, width: w = 0 } = p;
  const s = p.sides ?? { left: true, right: true, top: true, bottom: false };
  let per = 0;
  if (s.left) per += h;
  if (s.right) per += h;
  if (s.top) per += w;
  if (s.bottom) per += w;
  return clamp(per * Math.max(1, posInt(p.qty)));
}

/** Σ of the per-type counts — discrete points off a plan (шт, no scaling). */
function points(p: PointsPayload): number {
  return clamp((p.points ?? []).reduce((s, r) => s + posInt(r.count), 0));
}

/** A drop is |bus level − the point's height| × qty, in mm. */
function dropMm(p: ShtrobaPayload, pt: ShtrobaPayload['points'][number]): number {
  const level = p.busFromTop === false ? 0 : (p.busLevel ?? 0);
  return Math.abs(level - (pt.h ?? 0)) * Math.max(1, posInt(pt.qty));
}

/** CABLE (м): bus + EVERY drop, then + reserve% — the wire reaches every point and needs slack. */
function cable(p: ShtrobaPayload): number {
  const drops = (p.points ?? []).reduce((s, pt) => s + dropMm(p, pt), 0);
  const mm = ((p.busLength ?? 0) + drops) * (1 + (p.reservePct ?? 0) / 100);
  return clamp(mm / 1000);
}

/** SHTROBA (м.пог): only what is actually cut — the bus if flagged + the flagged drops, no reserve. */
function chase(p: ShtrobaPayload): number {
  const bus = p.busChase === false ? 0 : (p.busLength ?? 0);
  const drops = (p.points ?? [])
    .filter((pt) => pt.chase !== false)
    .reduce((s, pt) => s + dropMm(p, pt), 0);
  return clamp((bus + drops) / 1000);
}

/** The element's result in its type's unit. Unknown/garbage payload → 0 (never NaN into money). */
export function computeMeasurementResult(type: MeasurementType, payload: MeasurementPayload): number {
  try {
    switch (type) {
      case 'SURFACE': return surface(payload as SurfacePayload);
      case 'PARTITION': return partition(payload as PartitionPayload);
      case 'LINEAR': return linear(payload as LinearPayload);
      case 'ELECTRICAL_POINTS': return points(payload as PointsPayload);
      case 'SHTROBA': return chase(payload as ShtrobaPayload);
      case 'CABLE': return cable(payload as ShtrobaPayload);
      default: return 0;
    }
  } catch {
    return 0;
  }
}

/**
 * Re-derive every room total and the object totals — bucketed by UNIT, exactly like the server:
 * m² → area, м.пог → linear, шт → pieces, and м (cable) into none of them (an electrical figure
 * that must never inflate the object's area).
 */
export function recomputeTree(tree: MeasurementsResponse): MeasurementsResponse {
  const rooms: MeasurementRoom[] = tree.rooms.map((room) => {
    const totals = room.items.reduce(
      (acc, i: MeasurementItem) => {
        if (i.unit === 'M2') acc.area += i.result;
        else if (i.unit === 'LINEAR_METER') acc.linear += i.result;
        else if (i.unit === 'PIECE') acc.piece += i.result;
        return acc;
      },
      { area: 0, linear: 0, piece: 0 },
    );
    return {
      ...room,
      areaTotal: round3(totals.area),
      linearTotal: round3(totals.linear),
      pieceTotal: round3(totals.piece),
    };
  });
  return {
    rooms,
    areaTotal: round3(rooms.reduce((s, r) => s + r.areaTotal, 0)),
    linearTotal: round3(rooms.reduce((s, r) => s + r.linearTotal, 0)),
    pieceTotal: round3(rooms.reduce((s, r) => s + r.pieceTotal, 0)),
  };
}
