import { useTranslation } from 'react-i18next';
import type { Built } from '@/lib/shapes.ts';
import { DIAGRAM_H, DIAGRAM_W, layoutDiagram } from '@/lib/shapeDiagramLayout.ts';

/**
 * Textbook-style drawing of a surface shape: the polygon scaled to fit the box, the
 * letter of each measured side printed outside its midpoint, the vertices, and a
 * dashed height with a right-angle marker.
 *
 * The letters are the whole point — they match the labels above the inputs, so the
 * master always sees WHICH side to put the tape on. Before anything is typed we draw
 * the `outline` (reference proportions) dimmed rather than an empty box, so the
 * letters teach from the first render. The placement lives in `shapeDiagramLayout.ts`,
 * shared with the static wall-area page.
 */
export function ShapeDiagram({ built, outline }: { built: Built; outline: Built }) {
  const { t } = useTranslation();
  const { drawn, dimmed, points, edgeLabels, vertexLabels, height } = layoutDiagram(built, outline);

  const caption = built.ok ? null : built.warnKey ? t('shape.impossible') : t('shape.enterDims');

  return (
    <div>
      <svg
        viewBox={`0 0 ${DIAGRAM_W} ${DIAGRAM_H}`}
        className="mx-auto block w-full max-w-[360px]"
        role="img"
        aria-label={t(drawn.formulaKey)}
      >
        <g className={dimmed ? 'opacity-30' : undefined}>
          <polygon
            points={points.map((p) => p.join(',')).join(' ')}
            className="fill-brand-soft stroke-brand"
            strokeWidth={2}
            strokeLinejoin="round"
          />

          {height && (
            <g className="stroke-primary">
              {(() => {
                const a = height.apex;
                const f = height.foot;
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
                      {height.tag}
                    </text>
                  </>
                );
              })()}
            </g>
          )}

          {edgeLabels.map((e, k) => (
            <text
              key={`e${k}`}
              x={e.p[0]}
              y={e.p[1]}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-primary text-[16px] font-bold italic"
            >
              {e.tag}
            </text>
          ))}

          {vertexLabels.map((v) => (
            <text
              key={`v${v.name}`}
              x={v.p[0]}
              y={v.p[1]}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-faint text-[12px] font-semibold"
            >
              {v.name}
            </text>
          ))}
        </g>
      </svg>

      {caption && <div className="-mt-2 text-center text-xs text-muted">{caption}</div>}
    </div>
  );
}
