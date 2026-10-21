import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn.ts';
import { ShapeDiagram } from '@/components/ShapeDiagram.tsx';
import {
  SHAPE_KEYS,
  buildPlane,
  buildPlaneOutline,
  defaultMode,
  modesOf,
  planeAreaM2,
  toPlane,
  variantOf,
  type LengthUnit,
  type PlaneDraft,
  type ShapeKey,
} from '@/lib/shapes.ts';

/**
 * Shape picker + dimension fields for ONE plane. The letter badge above each field
 * is the same letter drawn on the diagram — that pairing is the feature: it removes
 * the "which side did it want?" guesswork of a bare length×width calculator.
 *
 * Controlled: holds no state, emits the edited draft. The unit belongs to the whole
 * surface element, so it comes in as a prop and is only displayed here.
 */
export function ShapeInput({
  draft,
  unit,
  onChange,
  collapseShapes = false,
}: {
  draft: PlaneDraft;
  unit: LengthUnit;
  onChange: (d: PlaneDraft) => void;
  /** Show only «Прямокутник» (plus the shape in use) behind an «Інша форма ▾» — the line's
   *  calculator, where a rectangle is nearly every case and seven chips pushed the sizes down. */
  collapseShapes?: boolean;
}) {
  const { t } = useTranslation();
  const variant = variantOf(draft.shape, draft.mode);
  const built = buildPlane(toPlane(draft));
  const outline = buildPlaneOutline(draft.shape, draft.mode);
  const modes = modesOf(draft.shape);
  const areaM2 = planeAreaM2(toPlane(draft), unit);

  // Remember what was typed for each shape/mode so switching away and back RESTORES it
  // instead of wiping (a real annoyance: «переключився і всі дані стерлись»). The cache is
  // component-local and survives while this plane's editor is open.
  const cache = useRef<Record<string, Record<string, string>>>({});
  const key = (shape: ShapeKey, mode: string) => `${shape}:${mode}`;

  const switchTo = (shape: ShapeKey, mode: string) => {
    cache.current[key(draft.shape, draft.mode)] = draft.values; // stash the current entry
    onChange({ shape, mode, values: cache.current[key(shape, mode)] ?? {} }); // restore or fresh
  };

  const pickShape = (shape: ShapeKey) => switchTo(shape, defaultMode(shape));
  const [allShapes, setAllShapes] = useState(!collapseShapes);
  // The chosen shape stays in view when the rest fold away — a fold must never hide a choice.
  const shownShapes = allShapes ? SHAPE_KEYS : SHAPE_KEYS.filter((k) => k === 'rect' || k === draft.shape);

  return (
    <div className="space-y-3">
      {/* Shape chips — wrap on a phone rather than scroll, so none hide off-screen. */}
      <div className="flex flex-wrap gap-1.5">
        {shownShapes.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => pickShape(k)}
            className={cn(
              // 44px min — this is tapped on site, with a thumb, often in gloves.
              'min-h-[44px] rounded-full px-3.5 text-xs font-semibold transition-colors',
              draft.shape === k ? 'bg-primary text-canvas' : 'bg-surface-sunken text-primary',
            )}
          >
            {t(`shape.${k}.name`)}
          </button>
        ))}
        {!allShapes && (
          <button
            type="button"
            onClick={() => setAllShapes(true)}
            className="min-h-[44px] rounded-full px-3.5 text-xs font-semibold text-brand"
          >
            {t('shape.otherShape')}
          </button>
        )}
      </div>

      {modes.length > 1 && (
        <div className="inline-flex rounded-lg bg-surface-sunken p-0.5">
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchTo(draft.shape, m)}
              className={cn(
                'min-h-[40px] rounded-md px-3.5 text-xs font-semibold transition-colors',
                draft.mode === m ? 'bg-surface text-primary shadow-card' : 'text-muted',
              )}
            >
              {t(`shape.${draft.shape}.${m}.label`)}
            </button>
          ))}
        </div>
      )}

      <p className="text-xs text-muted">{t(`shape.${draft.shape}.${draft.mode}.hint`)}</p>

      {/* An imported «direct area» is a single number — offer the one-tap way to make it
          a real editable figure instead of leaving the master to hunt through the chips. */}
      {draft.shape === 'direct' && (
        <button type="button" onClick={() => pickShape('rect')}
          className="text-xs font-semibold text-brand">
          {t('shape.direct.toSizes')}
        </button>
      )}

      {/* Fields before the drawing: on a phone the drawing pushed them below the fold, and the
          letter badge already ties each one to its side. */}
      <div className="grid grid-cols-2 gap-2">
        {variant.fields.map((f) => (
          <label key={f.key} className="block">
            <span className="mb-1 flex items-center gap-1.5 text-xs text-muted">
              <span className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-brand-soft text-[13px] font-bold italic text-primary">
                {f.tag}
              </span>{' '}
              {t(`shape.${draft.shape}.${draft.mode}.field.${f.key}`)}
            </span>
            <div className="relative">
              <input
                inputMode="decimal"
                value={draft.values[f.key] ?? ''}
                onChange={(e) =>
                  onChange({ ...draft, values: { ...draft.values, [f.key]: e.target.value } })
                }
                className="w-full rounded-lg border border-border bg-surface py-2 pl-3 pr-9 text-base font-semibold text-primary outline-none focus:border-brand"
              />
              {/* Decorative: the unit is already stated by the switch, and letting it
                  into the label would make the field read "a ширинасм" to a screen reader. */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted"
              >
                {t(`lengthUnit.${unit}`)}
              </span>
            </div>
          </label>
        ))}
      </div>

      {built.warnKey && (
        <div className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
          {t(built.warnKey)}
        </div>
      )}
      {built.noteKey && <p className="text-xs text-muted">{t(built.noteKey)}</p>}

      <ShapeDiagram built={built} outline={outline} />
      {built.ok && built.diag != null && (
        <p className="text-xs text-muted">
          {t('shape.diagCheck', {
            value: built.diag.toFixed(1),
            unit: t(`lengthUnit.${unit}`),
          })}
        </p>
      )}

      <div className="flex items-center justify-between border-t border-border pt-2 text-sm">
        <span className="text-muted">{t(built.formulaKey)}</span>
        <span className="font-bold text-primary">
          {built.ok ? areaM2 : '—'} {t('units.M2')}
        </span>
      </div>
    </div>
  );
}
