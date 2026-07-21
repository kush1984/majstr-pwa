import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CHASE_KINDS } from '@/components/WallDiagram.tsx';
import { clamp01, type PlanPt } from '@/lib/planBus.ts';

/**
 * Top-down room plan the master draws the bus (магістраль) on: a to-scale rectangle with a
 * draggable bus polyline and draggable reference points. The bus LENGTH is measured off this
 * drawing (see {@link busLengthMm}) instead of being guessed — the reference points just help
 * the master route the bus past them. Touch-first: big hit targets, pointer events (mouse +
 * touch), one-finger drag. Geometry is normalised [0..1]; the parent owns the room size.
 */
export function PlanEditor({
  widthMm,
  lengthMm,
  bus,
  points,
  pointKinds,
  onBusChange,
  onPointsChange,
}: {
  widthMm: number;
  lengthMm: number;
  bus: PlanPt[];
  points: PlanPt[];
  /** Same order as `points` — colours the dot by its drop's kind. */
  pointKinds: string[];
  onBusChange: (bus: PlanPt[]) => void;
  onPointsChange: (points: PlanPt[]) => void;
}) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ kind: 'bus' | 'point'; idx: number } | null>(null);

  const VW = 520;
  const VH = 360;
  const P = 24;
  const availW = VW - 2 * P;
  const availH = VH - 2 * P;
  const aspect = widthMm > 0 && lengthMm > 0 ? widthMm / lengthMm : 4 / 3;
  let rw = availW;
  let rh = availW / aspect;
  if (rh > availH) {
    rh = availH;
    rw = availH * aspect;
  }
  const ox = (VW - rw) / 2;
  const oy = (VH - rh) / 2;
  const toPx = (p: PlanPt) => ({ x: ox + p.x * rw, y: oy + p.y * rh });

  // Client → SVG-viewBox coords (the svg's rendered size differs from the viewBox).
  const toNorm = (e: ReactPointerEvent): PlanPt => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return { x: 0, y: 0 };
    const vx = ((e.clientX - rect.left) / rect.width) * VW;
    const vy = ((e.clientY - rect.top) / rect.height) * VH;
    return { x: clamp01((vx - ox) / rw), y: clamp01((vy - oy) / rh) };
  };

  const onDown = (kind: 'bus' | 'point', idx: number) => (e: ReactPointerEvent) => {
    e.preventDefault();
    drag.current = { kind, idx };
    svgRef.current?.setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toNorm(e);
    if (d.kind === 'bus') {
      onBusChange(bus.map((v, i) => (i === d.idx ? p : v)));
    } else {
      onPointsChange(points.map((v, i) => (i === d.idx ? p : v)));
    }
  };
  const onUp = (e: ReactPointerEvent) => {
    drag.current = null;
    svgRef.current?.releasePointerCapture?.(e.pointerId);
  };

  const busPath = bus.map(toPx);
  const d = busPath.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VW} ${VH}`}
      className="block w-full touch-none rounded-lg bg-surface-sunken"
      role="img"
      aria-label={t('plan.alt')}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {/* room */}
      <rect x={ox} y={oy} width={rw} height={rh} rx={6}
        className="fill-surface stroke-muted" strokeWidth={2} />

      {/* bus polyline */}
      {busPath.length >= 2 && (
        <path d={d} className="stroke-brand" strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      )}

      {/* reference points (drops) */}
      {points.map((p, i) => {
        const c = toPx(p);
        const colour = CHASE_KINDS[pointKinds[i]]?.color ?? '#8A6D5A';
        return (
          <g key={`pt${i}`} onPointerDown={onDown('point', i)} className="cursor-move">
            <circle cx={c.x} cy={c.y} r={20} fill="transparent" />
            <circle cx={c.x} cy={c.y} r={11} fill={colour} />
            <text x={c.x} y={c.y + 1} textAnchor="middle" dominantBaseline="middle"
              className="fill-white text-[10px] font-bold">{i + 1}</text>
          </g>
        );
      })}

      {/* bus vertices — the first is the entry (щиток) */}
      {busPath.map((p, i) => (
        <g key={`bv${i}`} onPointerDown={onDown('bus', i)} className="cursor-move">
          <circle cx={p.x} cy={p.y} r={20} fill="transparent" />
          <circle cx={p.x} cy={p.y} r={i === 0 ? 9 : 7}
            className="fill-surface stroke-brand" strokeWidth={3} />
          {i === 0 && (
            <text x={p.x} y={p.y - 14} textAnchor="middle" className="fill-brand text-[10px] font-bold">
              {t('plan.entry')}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
