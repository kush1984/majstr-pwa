import { useTranslation } from 'react-i18next';
import type { Built, Pt } from '@/lib/shapes.ts';

/**
 * Textbook-style drawing of a surface shape: the polygon scaled to fit the box, the
 * letter of each measured side printed outside its midpoint, the vertices, and a
 * dashed height with a right-angle marker.
 *
 * The letters are the whole point — they match the labels above the inputs, so the
 * master always sees WHICH side to put the tape on. Before anything is typed we draw
 * the `outline` (reference proportions) dimmed rather than an empty box, so the
 * letters teach from the first render.
 */
export function ShapeDiagram({ built, outline }: { built: Built; outline: Built }) {
  const { t } = useTranslation();
  const drawn = built.ok ? built : outline;
  const dimmed = !built.ok;

  const W = 340;
  const H = 250;
  const pad = 44;

  const xs = drawn.pts.map((p) => p[0]);
  const ys = drawn.pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rX = maxX - minX || 1;
  const rY = maxY - minY || 1;
  const s = Math.min((W - 2 * pad) / rX, (H - 2 * pad) / rY);
  const offX = (W - rX * s) / 2;
  const offY = (H - rY * s) / 2;
  // y grows upward in the model, downward in SVG.
  const tx = (p: Pt): Pt => [(p[0] - minX) * s + offX, H - ((p[1] - minY) * s + offY)];

  const T = drawn.pts.map(tx);
  const cx = T.reduce((a, p) => a + p[0], 0) / T.length;
  const cy = T.reduce((a, p) => a + p[1], 0) / T.length;
  /** Push a point away from the centroid so labels sit outside the figure. */
  const out = (p: Pt, dist: number): Pt => {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const len = Math.hypot(dx, dy) || 1;
    return [p[0] + (dx / len) * dist, p[1] + (dy / len) * dist];
  };

  const caption = built.ok ? null : built.warnKey ? t('shape.impossible') : t('shape.enterDims');

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mx-auto block w-full max-w-[360px]"
        role="img"
        aria-label={t(drawn.formulaKey)}
      >
        <g className={dimmed ? 'opacity-30' : undefined}>
          <polygon
            points={T.map((p) => p.join(',')).join(' ')}
            className="fill-brand-soft stroke-brand"
            strokeWidth={2}
            strokeLinejoin="round"
          />

          {drawn.height && (
            <g className="stroke-primary">
              {(() => {
                const a = tx(drawn.height.apex);
                const f = tx(drawn.height.foot);
                const sq = 9;
                return (
                  <>
                    <line x1={a[0]} y1={a[1]} x2={f[0]} y2={f[1]} strokeWidth={1.3} strokeDasharray="5 4" />
                    {/* right-angle marker at the foot */}
                    <path
                      d={`M ${f[0] + sq} ${f[1]} L ${f[0] + sq} ${f[1] - sq} L ${f[0]} ${f[1] - sq}`}
                      fill="none"
                      strokeWidth={1.3}
                    />
                    <text
                      x={(a[0] + f[0]) / 2 - 14}
                      y={(a[1] + f[1]) / 2}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="fill-primary stroke-none text-[16px] font-bold italic"
                    >
                      {drawn.height.tag}
                    </text>
                  </>
                );
              })()}
            </g>
          )}

          {drawn.edges.map((e, k) => {
            const a = T[e.i];
            const b = T[e.j];
            const p = out([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], 20);
            return (
              <text
                key={`e${k}`}
                x={p[0]}
                y={p[1]}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-primary text-[16px] font-bold italic"
              >
                {e.tag}
              </text>
            );
          })}

          {T.map((p, k) => {
            const q = out(p, 15);
            return (
              <text
                key={`v${k}`}
                x={q[0]}
                y={q[1]}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-faint text-[12px] font-semibold"
              >
                {drawn.vnames[k]}
              </text>
            );
          })}
        </g>
      </svg>

      {caption && <div className="-mt-2 text-center text-xs text-muted">{caption}</div>}
    </div>
  );
}
