import { useRef } from 'react';
import { isNarrow, type Opening, type SurfaceLayout } from '@/lib/tileLayout.ts';

/**
 * One surface as the engine laid it: whole tiles plain, cut pieces orange, a narrow strip red with its
 * width in mm, openings dashed. Drawn from the SAME pieces the count comes from, so the picture can
 * never show a layout the figures were not made for.
 *
 * With `onMoveGrid` it is also the handle: drag the tiles to move the grid, drag a door or a window to
 * move it along the wall. The drawing owns no state — it reports millimetres, the screen re-lays out.
 */
export function TileLayoutDrawing({
  width,
  height,
  layout,
  openings,
  tile,
  label,
  compact = false,
  onMoveGrid,
  onMoveOpening,
}: {
  width: number;
  height: number;
  layout: SurfaceLayout;
  openings: Opening[];
  tile: { w: number; h: number };
  label: string;
  compact?: boolean;
  /** The grid's new origin (mm), from the one it had when the drag began. */
  onMoveGrid?: (origin: { x: number; y: number }) => void;
  onMoveOpening?: (index: number, at: { x: number; y: number }) => void;
}) {
  const box = compact ? 140 : 300;
  const pad = compact ? 2 : 18;
  const scale = Math.min((box - 2 * pad) / width, (box - 2 * pad) / height);
  const vw = width * scale + 2 * pad;
  const vh = height * scale + 2 * pad;
  const X = (x: number) => pad + x * scale;
  // SVG y runs down; the engine's runs up from the floor.
  const Y = (y: number, h: number) => pad + (height - y - h) * scale;
  const drag = useRef<{ id: number; px: number; py: number; opening: number | null; from: { x: number; y: number } } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const draggable = Boolean(onMoveGrid);

  /** Screen pixels → millimetres on the surface; y up, as the engine counts it. */
  const toMm = (dxPx: number, dyPx: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const unit = rect && rect.width > 0 ? vw / rect.width : 1;
    return { dx: (dxPx * unit) / scale, dy: (-dyPx * unit) / scale };
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!draggable) return;
    const hit = (e.target as Element).getAttribute('data-opening');
    const opening = hit == null ? null : Number(hit);
    const from = opening == null ? layout.origin : { x: openings[opening].x, y: openings[opening].y };
    drag.current = { id: e.pointerId, px: e.clientX, py: e.clientY, opening, from };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const { dx, dy } = toMm(e.clientX - d.px, e.clientY - d.py);
    const at = { x: Math.round(d.from.x + dx), y: Math.round(d.from.y + dy) };
    if (d.opening == null) onMoveGrid?.(at);
    else onMoveOpening?.(d.opening, at);
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${vw} ${vh}`}
      role="img"
      aria-label={label}
      className={draggable ? 'block h-auto w-full cursor-grab touch-none select-none' : 'block h-auto w-full'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <rect x={pad} y={pad} width={width * scale} height={height * scale} rx={2} className="fill-surface-sunken" />
      {layout.pieces.map((p, i) => {
        const narrowW = p.kind !== 'FULL' && (!p.factory.L || !p.factory.R) && isNarrow(p.w, tile.w) && p.w < tile.w - 0.5;
        const narrowH = p.kind !== 'FULL' && (!p.factory.B || !p.factory.T) && isNarrow(p.h, tile.h) && p.h < tile.h - 0.5;
        const narrow = narrowW || narrowH;
        const tone = p.kind === 'FULL'
          ? 'fill-surface stroke-border'
          : narrow ? 'fill-danger-soft stroke-danger' : 'fill-brand-soft stroke-brand';
        return (
          <rect
            key={i}
            x={X(p.x)}
            y={Y(p.y, p.h)}
            width={Math.max(p.w * scale, 0.5)}
            height={Math.max(p.h * scale, 0.5)}
            strokeWidth={0.6}
            className={tone}
          />
        );
      })}
      {openings.map((o, i) => (
        <rect
          key={`o${i}`}
          data-opening={i}
          x={X(o.x)}
          y={Y(o.y, o.h)}
          width={o.w * scale}
          height={o.h * scale}
          className={draggable ? 'cursor-move fill-surface stroke-faint' : 'fill-surface stroke-faint'}
          strokeDasharray="3 2"
          strokeWidth={0.8}
        />
      ))}
      {!compact && layout.edges.map((e) => {
        const text = `${Math.round(e.min)}`;
        const cls = e.narrow ? 'pointer-events-none fill-danger font-bold' : 'pointer-events-none fill-muted';
        if (e.side === 'L' || e.side === 'R') {
          return (
            <text key={e.side} x={e.side === 'L' ? X(0) : X(width)} y={vh - 4} fontSize={10}
              textAnchor={e.side === 'L' ? 'start' : 'end'} className={cls}>
              {text}
            </text>
          );
        }
        return (
          <text key={e.side} x={4} y={e.side === 'T' ? pad + 10 : vh - pad - 2} fontSize={10} className={cls}>
            {text}
          </text>
        );
      })}
    </svg>
  );
}
