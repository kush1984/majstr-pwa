import { useTranslation } from 'react-i18next';

export type ChasePoint = { kind: string; h: number; qty: number; chase: boolean };

/** Point kinds are labels only — they never affect the maths, just the colour/legend. */
export const CHASE_KINDS: Record<string, { labelKey: string; defH: number; color: string }> = {
  socket: { labelKey: 'shtroba.kindSocket', defH: 300, color: '#2F6DB0' },
  switch: { labelKey: 'shtroba.kindSwitch', defH: 900, color: '#2E7D46' },
  light: { labelKey: 'shtroba.kindLight', defH: 2500, color: '#E0932F' },
  outlet: { labelKey: 'shtroba.kindOutlet', defH: 1200, color: '#8A6D5A' },
};

/**
 * The wall as the electrician chases it: one horizontal bus (along the top or the floor) plus
 * a vertical drop to every point. Heights are to scale (that's the essence of the drop), but
 * the horizontal spacing is only schematic — points are laid out evenly, because the bus
 * length is an explicit input, not a geometry read off this drawing. A drop (or the bus) that
 * is NOT chased is drawn dashed/grey — it's still wired (cable) but not cut (штроба). The
 * drawing is a check on the arithmetic: the master sees WHERE the metres come from. Millimetres.
 */
export function WallDiagram({
  points,
  busLevel,
  busFromTop,
  busChase,
}: {
  points: ChasePoint[];
  busLevel: number;
  busFromTop: boolean;
  busChase: boolean;
}) {
  const { t } = useTranslation();
  const W = 520;
  const H = 230;
  const padX = 34;
  const wallTop = 26;
  const wallBot = H - 30;

  // Vertical scale: tallest of the bus level, the highest point, or a sane default.
  const top = Math.max(busLevel, ...points.map((p) => p.h), 2700) || 2700;
  const sy = (h: number) => wallBot - (Math.min(h, top) / top) * (wallBot - wallTop);
  // Even, schematic horizontal spacing (the bus length is an explicit field, not read here).
  const span = W - 2 * padX;
  const px = (i: number) => padX + (points.length <= 1 ? span / 2 : (i / (points.length - 1)) * span);
  const busY = busFromTop ? sy(busLevel) : wallBot;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full rounded-lg bg-surface-sunken" role="img"
      aria-label={t('shtroba.diagramAlt')}>
      <text x={padX} y={wallBot + 18} className="fill-faint text-[10px]">{t('shtroba.floor')}</text>
      <line x1={padX} y1={wallBot} x2={W - padX} y2={wallBot} className="stroke-muted" strokeWidth={1.5} />
      <line x1={padX} y1={wallTop} x2={W - padX} y2={wallTop} className="stroke-border" strokeWidth={1} strokeDasharray="3 3" />

      {/* the shared horizontal bus — dashed/grey when it runs uncut (e.g. along the ceiling) */}
      <line x1={padX} y1={busY} x2={W - padX} y2={busY}
        className={busChase ? 'stroke-brand' : 'stroke-muted'} strokeWidth={4} strokeLinecap="round"
        strokeDasharray={busChase ? undefined : '6 5'} opacity={busChase ? 1 : 0.7} />
      <text x={padX + 2} y={busY + (busFromTop ? 14 : -7)}
        className={cnFill(busChase)}>{t('shtroba.bus')}</text>

      {points.map((p, i) => {
        const X = px(i);
        const Y = sy(p.h);
        const colour = CHASE_KINDS[p.kind]?.color ?? '#8A6D5A';
        return (
          <g key={i}>
            <line x1={X} y1={busY} x2={X} y2={Y}
              className={p.chase ? 'stroke-brand' : 'stroke-muted'} strokeWidth={3} strokeLinecap="round"
              strokeDasharray={p.chase ? undefined : '5 4'} opacity={p.chase ? 0.85 : 0.6} />
            <circle cx={X} cy={Y} r={11} fill={colour} />
            <text x={X} y={Y + 1} textAnchor="middle" dominantBaseline="middle"
              className="fill-white text-[10px] font-bold">{i + 1}</text>
            {p.qty > 1 && (
              <text x={X + 14} y={Y - 8} className="text-[9.5px] font-bold" fill={colour}>×{p.qty}</text>
            )}
          </g>
        );
      })}

      {points.length === 0 && (
        <text x={W / 2} y={H / 2} textAnchor="middle" className="fill-faint text-[12px]">
          {t('shtroba.addPointsHint')}
        </text>
      )}
    </svg>
  );
}

const cnFill = (on: boolean): string =>
  `text-[10px] font-bold ${on ? 'fill-brand' : 'fill-muted'}`;
