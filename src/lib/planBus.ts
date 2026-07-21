/**
 * Plan-view geometry for the chase/cable calculator (Phase C). The master draws the bus
 * (магістраль) as a polyline on a to-scale room rectangle; its length is MEASURED off the
 * drawing rather than guessed — the same "read/measure a thing you can see" honesty as the
 * rest of the electrical feature, only here the master is the one drawing.
 *
 * Coordinates are normalised [0..1] against the room rectangle, so they are resolution- and
 * scale-independent; a length is only realised once the room's real width/length (mm) are known.
 */
export interface PlanPt {
  /** 0 = left wall, 1 = right wall. */
  x: number;
  /** 0 = top wall, 1 = bottom wall. */
  y: number;
}

/** Clamp a raw normalised coordinate into the room. */
export function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Length of the bus polyline in millimetres. Each normalised segment is scaled by the room's
 * real width (x) and length (y) before its Euclidean length is taken, so a diagonal run is
 * measured correctly. < 2 vertices → 0.
 */
export function busLengthMm(path: PlanPt[], widthMm: number, lengthMm: number): number {
  if (!path || path.length < 2) return 0;
  const w = Math.max(0, widthMm);
  const l = Math.max(0, lengthMm);
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = (path[i].x - path[i - 1].x) * w;
    const dy = (path[i].y - path[i - 1].y) * l;
    total += Math.hypot(dx, dy);
  }
  return Math.round(total);
}

/** A horizontal bus near the top (default) or floor — the usual first routing. */
export function defaultBus(fromTop: boolean): PlanPt[] {
  const y = fromTop ? 0.06 : 0.94;
  return [{ x: 0.04, y }, { x: 0.96, y }];
}

/** Evenly space n reference points along the opposite wall to the bus, for the master to drag. */
export function defaultPoints(n: number, fromTop: boolean): PlanPt[] {
  const y = fromTop ? 0.9 : 0.1;
  if (n <= 0) return [];
  return Array.from({ length: n }, (_, i) => ({ x: n === 1 ? 0.5 : 0.08 + (0.84 * i) / (n - 1), y }));
}
