import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { toast } from '@/hooks/useToast.ts';
import { formatNumber } from '@/lib/format.ts';
import { parseDecimal } from '@/lib/decimal.ts';
import { routes } from '@/lib/config.ts';
import { materialsApi } from '@/api/materials.ts';
import { SHOPPING_KEY, SHOPPING_SUMMARY_KEY } from '@/features/shopping/useShoppingList.ts';
import { readParams, saveParams, type StoredParams } from './useMaterialParams.ts';
import type {
  CalculatedMaterialLine,
  MaterialCalculationResponse,
  MaterialLineRequest,
  MaterialSourceLine,
  MissingParameter,
} from '@/api/types.ts';

/** One position waiting for a figure only the master knows, and the number we would suggest. */
interface AskedPosition {
  estimateItemId: string;
  name: string;
  suggested?: number | null;
  /** The figure is already in the answer — the card shows it so it can be changed, not asked for. */
  answered?: boolean;
}

/** The two variants of every word on a parameter card: still asking, or showing what he answered. */
interface AskLabels {
  title: string;
  titleSet: string;
  hint: string;
  /** Goes into the field's own label, beside the position name — the unit is the question. */
  unit: string;
  apply: string;
  applySet: string;
  suggested: string;
  remembered: string;
}

/**
 * «Скільки матеріалу купити» — the estimate's works read as a buying list (V127).
 *
 * Three things make this screen honest rather than clever, and all three are load-bearing:
 *
 * - every number is EDITABLE — the norms are a starting point for a conversation, not a verdict,
 *   and the master's own figure is what leaves this screen;
 * - every row shows its arithmetic — «20 м² × 1 лист/м² = 20», so a wrong answer is visibly wrong
 *   instead of mysteriously wrong;
 * - one calm line says what the answer covers — «Порахували матеріали для: Гіпсокартон, Малярні
 *   роботи» (master's wording). It replaced «Порахували 8 з 39 позицій» over a list of the 31
 *   others: on his own estimate those were demolition and cleanup lines that consume no material,
 *   so the screen read as broken while the arithmetic was right.
 *
 * The waste allowance re-asks the server rather than scaling on the client: rounding runs UP to a
 * whole package, so 5 % and 10 % of the same base are not a multiplication apart. Correcting a norm
 * re-asks for exactly the same reason.
 *
 * There is exactly ONE destination — the shopping list. Materials do not become estimate lines
 * (the master's «прибираємо», V129): they would land at 0 ₴ by the V81 rule, and a priceless line
 * inside a document the client signs is worse than no line at all. The endpoint is gone server-side.
 */
const WASTE_STEPS = [5, 10, 15];

/**
 * A figure the master typed, or null when what he typed is not one — metres for a perimeter or a
 * розгортка, millimetres for a layer thickness.
 *
 * <p>«abc» parses to NaN, and NaN used to be applied and sent — the server answers 400, so the
 * screen blamed the connection for a typo and offered nothing to fix. The upper bound is a sanity
 * check rather than a rule of building: no room on this screen is a kilometre around and no layer
 * is a metre thick, and a stray extra digit is the mistake it actually catches. One bound serves
 * both units because it is that stray digit it is looking for, not a building code.</p>
 */
const MAX_FIGURE = 1000;
function figure(raw: string): number | null {
  const value = parseDecimal(raw);
  return Number.isFinite(value) && value > 0 && value <= MAX_FIGURE ? value : null;
}

/**
 * The positions still waiting on one kind of figure, one entry per POSITION rather than per
 * material: a короб's board and its ribs share one розгортка, and every layer of one plastered wall
 * is the same thickness — but a короб and a ніша in the same estimate are different boxes, and
 * «штукатурка стін» and «стяжка підлоги» are different thicknesses, so each is asked separately.
 */
function askedPositions(parameters: MissingParameter[], kind: string): AskedPosition[] {
  const byPosition = new Map<string, AskedPosition>();
  for (const p of parameters) {
    if (p.parameter !== kind || !p.estimateItemId) continue;
    if (byPosition.has(p.estimateItemId)) continue;
    byPosition.set(p.estimateItemId, {
      estimateItemId: p.estimateItemId,
      name: p.positionName ?? '',
      suggested: p.suggested,
    });
  }
  return [...byPosition.values()];
}

/**
 * The same card keeps standing once the question is answered, now showing the figure the answer was
 * built on — the server only reports what is MISSING, so an answered position is read back off the
 * arithmetic (`sources`, which carries the position, its basis and the param that was used).
 *
 * <p>Without this the card vanished the moment it was answered, and with the answer now remembered
 * across visits (see `useMaterialParams`) a thickness typed once would have had nowhere left to be
 * corrected. Unanswered positions come first: they are the ones holding the calculation up.</p>
 */
function parameterPositions(data: MaterialCalculationResponse, kind: string): AskedPosition[] {
  const byPosition = new Map<string, AskedPosition>();
  for (const p of askedPositions(data.parameters, kind)) byPosition.set(p.estimateItemId, p);
  for (const line of data.materials) {
    for (const source of line.sources) {
      if (source.basis !== kind || !source.estimateItemId) continue;
      if (byPosition.has(source.estimateItemId)) continue;
      byPosition.set(source.estimateItemId, {
        estimateItemId: source.estimateItemId,
        name: source.name ?? '',
        suggested: source.param,
        answered: true,
      });
    }
  }
  return [...byPosition.values()];
}

/**
 * A quantity the master typed over ours.
 *
 * <p>Blank is not an error — it is how he says «не це», and the row drops out of the list. Anything
 * that is not a positive number IS one, and used to be dropped just as silently: `parseDecimal('abc')`
 * is NaN, the payload filter removed it, and the rest went off to the shopping list. He found out at
 * the merchant, by the material not being on it.</p>
 */
/**
 * The per-position answers as the wire wants them — «uuid:0.4,uuid:15» — and the fields that are
 * not a figure at all.
 *
 * <p>Each position answers for itself: one left blank keeps asking rather than borrowing a
 * neighbour's. An UNREADABLE field is not a blank one, though the old filter treated them alike and
 * dropped it — the card just kept asking, with nothing on screen saying why. Nothing is sent until
 * every figure actually typed is a figure.</p>
 */
function encoded(inputs: Record<string, string>): {
  value?: string;
  errors: Record<string, boolean>;
} {
  const errors: Record<string, boolean> = {};
  const entries: string[] = [];
  for (const [itemId, raw] of Object.entries(inputs)) {
    if (raw.trim() === '') continue;
    const value = figure(raw);
    if (value == null) errors[itemId] = true;
    else entries.push(`${itemId}:${value}`);
  }
  return { value: entries.length > 0 ? entries.join(',') : undefined, errors };
}

function badQuantity(raw: string): boolean {
  if (raw.trim() === '') return false;
  const value = parseDecimal(raw);
  // 0 is not a typo — it is the second way he says «не це», and the row drops out of the payload.
  return !Number.isFinite(value) || value < 0;
}

export function MaterialCalculatorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const qc = useQueryClient();

  // What he answered last time on THIS estimate. Read once, straight into the initial state, so the
  // very first request already carries it — arrive with the figures remembered and the card has
  // nothing left to ask, which is the whole point of remembering them.
  const [stored] = useState<StoredParams>(() => readParams(id));

  const [waste, setWaste] = useState(10);
  const [perimeterInput, setPerimeterInput] = useState(stored.perimeter);
  const [perimeter, setPerimeter] = useState<number | undefined>(
    () => figure(stored.perimeter) ?? undefined,
  );
  const [perimeterError, setPerimeterError] = useState(false);
  const [sectionInputs, setSectionInputs] = useState<Record<string, string>>(stored.sections);
  const [sectionErrors, setSectionErrors] = useState<Record<string, boolean>>({});
  const [sections, setSections] = useState<string | undefined>(() => encoded(stored.sections).value);
  const [thicknessInputs, setThicknessInputs] = useState<Record<string, string>>(stored.thicknesses);
  const [thicknessErrors, setThicknessErrors] = useState<Record<string, boolean>>({});
  const [thicknesses, setThicknesses] = useState<string | undefined>(
    () => encoded(stored.thicknesses).value,
  );
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [openRow, setOpenRow] = useState<string | null>(null);

  const calc = useQuery({
    queryKey: ['materials', id, waste, perimeter ?? null, sections ?? null, thicknesses ?? null],
    queryFn: () =>
      materialsApi.calculate(id, { wastePercent: waste, perimeter, sections, thicknesses }),
    enabled: Boolean(id),
    // Every parameter change is a NEW key, so the whole screen used to collapse into a full-page
    // spinner — controls, figures and all — on each tap of the waste steps. Keeping the last answer
    // on screen turns that into a quiet recalculation of numbers he can watch move.
    placeholderData: keepPreviousData,
  });

  // The server re-rounds on every parameter change, so a figure typed against the old numbers
  // would silently claim to be «what the master left on the screen». Drop the overrides instead.
  useEffect(() => setEdited({}), [waste, perimeter, sections, thicknesses]);

  const data = calc.data;
  const materials = useMemo(() => data?.materials ?? [], [data]);

  // What the last SUCCESSFUL answer asked for, and what it was already answered with. The
  // parameters ride the query KEY, so a refused request is a different query holding no data at
  // all — and the perimeter/section cards would disappear at exactly the moment the master needs
  // them to correct the figure that was refused.
  const [asked, setAsked] = useState<{
    perimeter: boolean;
    section: AskedPosition[];
    thickness: AskedPosition[];
  }>({ perimeter: false, section: [], thickness: [] });
  useEffect(() => {
    if (!data) return;
    setAsked({
      perimeter: data.parameters.some((p) => p.parameter === 'PERIMETER') || data.perimeter != null,
      section: parameterPositions(data, 'SECTION'),
      thickness: parameterPositions(data, 'THICKNESS'),
    });
  }, [data]);

  const needsPerimeter = asked.perimeter;
  const sectionPositions = asked.section;
  const thicknessPositions = asked.thickness;

  /*
   * The suggestion is PRE-FILLED and not applied (V137). «Штукатурка стін (до 2 см)» names a bound
   * and not a thickness, and 15 мм against 20 мм is a third of the plaster — so the field opens
   * with our number visible, sitting under his thumb, and he taps «Порахувати» to make it his. A
   * default applied behind his back would be a guess wearing his name on a shopping list.
   *
   * A field he has touched is never refilled, an emptied one included: «» is an answer.
   */
  useEffect(() => {
    setThicknessInputs((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const p of thicknessPositions) {
        if (p.suggested == null || prev[p.estimateItemId] !== undefined) continue;
        next[p.estimateItemId] = String(p.suggested);
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [thicknessPositions]);

  // Tapping «Порахувати» is what makes an answer his, so that is where it is remembered — not on
  // every keystroke, which would store a half-typed «1» of «15».
  const applyPerimeter = () => {
    const raw = perimeterInput.trim();
    if (raw === '') {
      setPerimeterError(false);
      setPerimeter(undefined);
      saveParams(id, { perimeter: '' });
      return;
    }
    const value = figure(raw);
    if (value == null) {
      setPerimeterError(true);
      return;
    }
    setPerimeterError(false);
    setPerimeter(value);
    saveParams(id, { perimeter: raw });
  };

  const applyPerPosition = (
    kind: 'sections' | 'thicknesses',
    inputs: Record<string, string>,
    setErrors: (errors: Record<string, boolean>) => void,
    setValue: (value: string | undefined) => void,
  ) => {
    const { value, errors } = encoded(inputs);
    setErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setValue(value);
    saveParams(id, kind === 'sections' ? { sections: inputs } : { thicknesses: inputs });
  };

  // A corrected norm changes the base, and rounding up to a package does not commute with scaling —
  // so the server recomputes, and the overrides typed against the old figures go with it.
  const afterNormChange = () => {
    setEdited({});
    void qc.invalidateQueries({ queryKey: ['materials', id] });
  };

  const quantityOf = (line: CalculatedMaterialLine): number => {
    const override = edited[line.materialId];
    if (override === undefined) return line.quantity;
    return override.trim() ? parseDecimal(override) : 0;
  };

  const payload = (): MaterialLineRequest[] =>
    materials
      .map((m) => ({ materialId: m.materialId, quantity: quantityOf(m) }))
      .filter((m) => m.quantity > 0);

  const toShoppingList = useMutation({
    mutationFn: () => materialsApi.toShoppingList(id, { materials: payload() }),
    onSuccess: (list) => {
      void qc.invalidateQueries({ queryKey: SHOPPING_KEY(list.projectId) });
      void qc.invalidateQueries({ queryKey: SHOPPING_SUMMARY_KEY });
      toast.success(t('materials.sentToList'));
      void navigate(routes.shopping(list.projectId), { state: { from: routes.materials(id) } });
    },
    onError: () => toast.error(t('materials.saveFailed')),
  });

  const nothingPicked = payload().length === 0;
  // Held rather than dropped: the button says nothing can be sent until the typo is fixed, and the
  // row itself says which one.
  const badRows = useMemo(
    () =>
      new Set(
        Object.entries(edited)
          .filter(([, raw]) => badQuantity(raw))
          .map(([materialId]) => materialId),
      ),
    [edited],
  );

  if (calc.isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <div className="mx-auto max-w-xl px-4 pb-40 pt-4 sm:px-6">
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(routes.estimate(id))}
            aria-label={t('common.back')}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-lg text-primary"
          >
            ←
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-extrabold tracking-tight text-primary">
              {t('materials.title')}
            </h1>
            <p className="truncate text-xs text-muted">{t('materials.disclaimer')}</p>
          </div>
        </div>

        {/* The figures below are the PREVIOUS answer until the new one lands — say so, or a master
            reading a number that is about to move has no way to know it is about to move. */}
        {calc.isFetching && !calc.isLoading && (
          <p className="mb-3 text-xs text-muted">{t('materials.recalculating')}</p>
        )}

        {calc.isError && (
          <EmptyState icon="🧮" title={t('materials.errorTitle')} text={t('materials.loadError')} />
        )}

        {/* Coverage answers «what did the calculation cover», so with no quantities there was no
            calculation for it to answer about — and its empty form («норм ще немає») would stand
            directly above the empty state saying we DO know the norms. Two sentences contradicting
            each other on one screen is worse than either alone. */}
        {!calc.isError && data && !data.quantitiesMissing && (
          <Coverage trades={data.coverage.trades} otherWorks={data.coverage.otherWorks} />
        )}

        {!calc.isError && data && !data.estimateSigned && (
          <p className="mb-4 rounded-card border border-border bg-surface px-3 py-2 text-xs text-muted">
            {t('materials.unsignedEstimate')}
          </p>
        )}

        {/*
          The parameter and waste cards stand OUTSIDE the error branch. The parameters ride the
          query KEY, so a figure the server refuses is an ERROR query holding no data at all — and
          replacing the whole body with «Не вдалося порахувати» took away the very field the master
          had to correct. An error replaces the ANSWER, never the controls that produce it.
        */}
        {needsPerimeter && (
          <div className="mb-4 rounded-card border border-border bg-surface p-3">
            <p className="text-sm font-semibold text-primary">
              {perimeter == null ? t('materials.perimeterTitle') : t('materials.perimeterTitleSet')}
            </p>
            {perimeter == null && (
              <p className="mt-1 text-xs text-muted">{t('materials.perimeterHint')}</p>
            )}
            <div className="mt-2 flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <label htmlFor="perimeter" className="mb-1 block text-xs font-medium text-muted">
                  {t('materials.perimeterLabel')}
                </label>
                <Input
                  id="perimeter"
                  inputMode="decimal"
                  value={perimeterInput}
                  onChange={(e) => setPerimeterInput(e.target.value)}
                  placeholder="0"
                  aria-invalid={perimeterError || undefined}
                  aria-describedby={perimeterError ? 'perimeter-error' : undefined}
                />
              </div>
              <Button variant="secondary" onClick={applyPerimeter}>
                {perimeter == null ? t('materials.perimeterApply') : t('materials.recalculate')}
              </Button>
            </div>
            {perimeter != null && (
              <p className="mt-2 text-[11px] text-muted">{t('materials.paramsRemembered')}</p>
            )}
            {perimeterError && (
              <p id="perimeter-error" className="mt-1 text-xs text-danger">
                {t('materials.badNumber')}
              </p>
            )}
          </div>
        )}

        <PerPositionAsk
          idPrefix="section"
          positions={sectionPositions}
          inputs={sectionInputs}
          errors={sectionErrors}
          onInput={(itemId, value) => setSectionInputs((prev) => ({ ...prev, [itemId]: value }))}
          onApply={() =>
            applyPerPosition('sections', sectionInputs, setSectionErrors, setSections)
          }
          labels={{
            title: t('materials.sectionTitle'),
            titleSet: t('materials.sectionTitleSet'),
            hint: t('materials.sectionHint'),
            unit: t('materials.sectionUnit'),
            apply: t('materials.sectionApply'),
            applySet: t('materials.recalculate'),
            suggested: t('materials.sectionSuggested'),
            remembered: t('materials.paramsRemembered'),
          }}
        />

        <PerPositionAsk
          idPrefix="thickness"
          positions={thicknessPositions}
          inputs={thicknessInputs}
          errors={thicknessErrors}
          onInput={(itemId, value) => setThicknessInputs((prev) => ({ ...prev, [itemId]: value }))}
          onApply={() =>
            applyPerPosition('thicknesses', thicknessInputs, setThicknessErrors, setThicknesses)
          }
          labels={{
            title: t('materials.thicknessTitle'),
            titleSet: t('materials.thicknessTitleSet'),
            hint: t('materials.thicknessHint'),
            unit: t('materials.thicknessUnit'),
            apply: t('materials.thicknessApply'),
            applySet: t('materials.recalculate'),
            suggested: t('materials.thicknessSuggested'),
            remembered: t('materials.paramsRemembered'),
          }}
        />

        {!calc.isError && data && <Habits trades={data.coverage.trades} onSaved={afterNormChange} />}

        <div className="mb-4 rounded-card border border-border bg-surface p-3">
          <p className="text-sm font-semibold text-primary">{t('materials.wasteTitle')}</p>
          <div className="mt-2 flex gap-2">
            {WASTE_STEPS.map((step) => (
              <button
                key={step}
                type="button"
                onClick={() => setWaste(step)}
                aria-pressed={waste === step}
                className={
                  waste === step
                    ? 'min-h-11 flex-1 rounded-xl bg-brand-600 text-sm font-semibold text-white'
                    : 'min-h-11 flex-1 rounded-xl bg-surface-sunken text-sm font-medium text-primary'
                }
              >
                {t('materials.wasteStep', { percent: step })}
              </button>
            ))}
          </div>
        </div>

        {/* Two very different sentences behind one empty screen. An estimate straight out of a
            bundle has every quantity at zero, and telling him we know no norms for his work would
            be plainly false — he would go looking for a bug that is not there. */}
        {!calc.isError && materials.length === 0 && (
          calc.data?.quantitiesMissing ? (
            <EmptyState
              icon="✏️"
              title={t('materials.needQuantitiesTitle')}
              text={t('materials.needQuantitiesText')}
            />
          ) : (
            <EmptyState icon="🧮" title={t('materials.emptyTitle')} text={t('materials.emptyText')} />
          )
        )}

        {materials.length > 0 && (
          <div className="overflow-hidden rounded-card border border-border bg-surface">
            {materials.map((line) => (
              <MaterialRow
                key={line.materialId}
                line={line}
                value={edited[line.materialId] ?? String(line.quantity)}
                onChange={(v) => setEdited((prev) => ({ ...prev, [line.materialId]: v }))}
                invalid={badRows.has(line.materialId)}
                open={openRow === line.materialId}
                onToggle={() =>
                  setOpenRow((cur) => (cur === line.materialId ? null : line.materialId))
                }
                onNormChange={afterNormChange}
              />
            ))}
          </div>
        )}
      </div>

      {materials.length > 0 && (
        <div
          className="fixed inset-x-0 bottom-0 border-t border-border bg-surface px-4 pt-3 sm:px-6"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
        >
          <div className="mx-auto flex max-w-xl flex-col gap-2">
            <Button
              fullWidth
              loading={toShoppingList.isPending}
              disabled={toShoppingList.isPending || nothingPicked || badRows.size > 0}
              onClick={() => toShoppingList.mutate()}
            >
              🛒 {t('materials.toShoppingList')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One card asking the same question of several positions — a розгортка in metres (V131), a layer
 * thickness in millimetres (V137). One card and not two components, because the two asks differ
 * only in their wording and their unit, and a screen that asks both must ask them the same way.
 *
 * The card renders nothing when nothing is waiting on it, so the common estimate sees neither.
 */
function PerPositionAsk({
  idPrefix,
  positions,
  inputs,
  errors,
  onInput,
  onApply,
  labels,
}: {
  idPrefix: string;
  positions: AskedPosition[];
  inputs: Record<string, string>;
  errors: Record<string, boolean>;
  onInput: (estimateItemId: string, value: string) => void;
  onApply: () => void;
  labels: AskLabels;
}) {
  const { t } = useTranslation();
  if (positions.length === 0) return null;
  // Still waiting on at least one figure, so the card is a question. Once every position is
  // answered it is no longer asking anything — it is showing what the numbers were built on, and
  // a card headed «Потрібна товщина шару» over figures already used would read as a demand he had
  // somehow failed to meet.
  const pending = positions.some((p) => !p.answered);
  const suggested = positions.some((p) => !p.answered && p.suggested != null);

  return (
    <div className="mb-4 rounded-card border border-border bg-surface p-3">
      <p className="text-sm font-semibold text-primary">{pending ? labels.title : labels.titleSet}</p>
      {pending && <p className="mt-1 text-xs text-muted">{labels.hint}</p>}
      <div className="mt-2 space-y-2">
        {positions.map((p) => {
          const fieldId = `${idPrefix}-${p.estimateItemId}`;
          return (
            <div key={p.estimateItemId}>
              {/* The unit belongs in the LABEL and not only in the placeholder: every one of these
                  fields opens pre-filled (V137), so the placeholder — the only place that said
                  «мм» — is never on screen when the question is actually being answered, and a
                  master reading «5» has no way to tell millimetres from centimetres. */}
              <label htmlFor={fieldId} className="mb-1 block text-xs font-medium text-muted">
                {t('materials.positionWithUnit', { name: p.name, unit: labels.unit })}
              </label>
              <Input
                id={fieldId}
                inputMode="decimal"
                value={inputs[p.estimateItemId] ?? ''}
                onChange={(e) => onInput(p.estimateItemId, e.target.value)}
                placeholder={labels.unit}
                aria-invalid={errors[p.estimateItemId] || undefined}
                aria-describedby={errors[p.estimateItemId] ? `${fieldId}-error` : undefined}
              />
              {errors[p.estimateItemId] && (
                <p id={`${fieldId}-error`} className="mt-1 text-xs text-danger">
                  {t('materials.badNumber')}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {/* Our number is in the field, so the screen says out loud whose number it is: ours until he
          answers, his own — kept from last time — afterwards. */}
      {pending
        ? suggested && <p className="mt-2 text-[11px] text-muted">{labels.suggested}</p>
        : <p className="mt-2 text-[11px] text-muted">{labels.remembered}</p>}
      <Button variant="secondary" fullWidth className="mt-2" onClick={onApply}>
        {pending ? labels.apply : labels.applySet}
      </Button>
    </div>
  );
}

/**
 * «Мої звички» — the two answers that are true of the MASTER and not of the object (V137).
 *
 * Paint coverage × coats rescales every paint figure; the joint width rescales the grout. They are
 * habits, so they are asked once and remembered — and they were the real defect V137 found: the
 * keys existed in the schema since V126 and NOTHING read them, so a master painting three coats got
 * two coats' worth of paint on every estimate, silently, with a settings row that looked answered.
 *
 * Folded shut by default and shown only for the trades ON THIS ESTIMATE: a drywaller must not be
 * handed a paint question, and a screen he has to scroll past four irrelevant fields to reach is a
 * screen he stops opening.
 */
function Habits({ trades, onSaved }: { trades: string[]; onSaved: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);

  const prefs = useQuery({
    queryKey: ['material-prefs'],
    queryFn: () => materialsApi.prefs(),
    enabled: open,
  });

  const stored = prefs.data?.prefs;
  useEffect(() => {
    if (stored) setDraft({ ...stored });
  }, [stored]);

  const save = useMutation({
    // Every field this card shows is sent, blanks included: a blank FORGETS the habit server-side,
    // so omitting a cleared field would quietly keep the number he just deleted.
    mutationFn: (values: Record<string, string>) => materialsApi.savePrefs({ prefs: values }),
    onSuccess: (answer) => {
      setDraft({ ...answer.prefs });
      void qc.setQueryData(['material-prefs'], answer);
      toast.success(t('materials.habitsSaved'));
      onSaved();
    },
    onError: () => toast.error(t('materials.habitsFailed')),
  });

  const fields = [
    ...(trades.includes('PAINTER')
      ? [
          { key: 'PAINT_COVERAGE', label: t('materials.habitCoverage') },
          { key: 'PAINT_COATS', label: t('materials.habitCoats') },
        ]
      : []),
    ...(trades.includes('TILING') ? [{ key: 'TILE_JOINT_MM', label: t('materials.habitJoint') }] : []),
    ...(trades.includes('DRYWALL') ? [{ key: 'GKL_SHEET', label: t('materials.habitSheet') }] : []),
  ];
  if (fields.length === 0) return null;

  const value = (key: string) => draft?.[key] ?? '';

  return (
    <div className="mb-4 rounded-card border border-border bg-surface p-3">
      <button
        type="button"
        onClick={() => setOpen((cur) => !cur)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-sm font-semibold text-primary">{t('materials.habitsTitle')}</span>
        <span className="text-xs text-muted">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-2">
          <p className="text-xs text-muted">{t('materials.habitsHint')}</p>
          {prefs.isLoading ? (
            <div className="py-3">
              <Spinner />
            </div>
          ) : (
            <>
              <div className="mt-2 space-y-2">
                {fields.map((f) => (
                  <div key={f.key}>
                    <label
                      htmlFor={`habit-${f.key}`}
                      className="mb-1 block text-xs font-medium text-muted"
                    >
                      {f.label}
                    </label>
                    <Input
                      id={`habit-${f.key}`}
                      inputMode={f.key === 'GKL_SHEET' ? 'text' : 'decimal'}
                      value={value(f.key)}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...(prev ?? {}), [f.key]: e.target.value }))
                      }
                    />
                  </div>
                ))}
              </div>
              <Button
                variant="secondary"
                fullWidth
                className="mt-2"
                loading={save.isPending}
                disabled={save.isPending}
                onClick={() =>
                  save.mutate(Object.fromEntries(fields.map((f) => [f.key, value(f.key)])))
                }
              >
                {t('materials.habitsSave')}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * What the answer covers, in one line: «Порахували матеріали для: Гіпсокартон, Малярні роботи».
 *
 * Not amber, no toggle, no list. The master's ruling (2026-09-11) — «то думаю треба забрати і
 * просто писати для якої категорії пораховано» — because the thing being confessed was not a
 * defect: a demolition line has no material to buy, and 31 amber lines saying so made a working
 * screen look broken.
 */
function Coverage({ trades, otherWorks }: { trades: string[]; otherWorks: boolean }) {
  const { t } = useTranslation();
  const labels = [
    ...trades.map((code) => t('trades.' + code)),
    ...(otherWorks ? [t('materials.coverageOther')] : []),
  ];

  return (
    <div className="mb-4 rounded-card border border-border bg-surface p-3">
      <p className="text-sm font-semibold text-primary">
        {labels.length > 0
          ? t('materials.coverage', { trades: labels.join(', ') })
          : t('materials.coverageNone')}
      </p>
    </div>
  );
}

/**
 * One material: the name, what it comes packaged in, and an editable quantity. «Показати
 * розрахунок» unfolds the arithmetic — which positions asked for it, and at what rate.
 */
function MaterialRow({
  line,
  value,
  onChange,
  invalid,
  open,
  onToggle,
  onNormChange,
}: {
  line: CalculatedMaterialLine;
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
  open: boolean;
  onToggle: () => void;
  onNormChange: () => void;
}) {
  const { t } = useTranslation();

  // The packages follow the number ON THE ROW, not the one the server last sent. «5 × мішок» under a
  // quantity the master had corrected to 200 кг was our arithmetic contradicting his, on the same
  // line — and the packages are the thing he actually carries to the till.
  const typed = parseDecimal(value);
  const packages =
    line.packageSize != null && line.packageSize > 0 && typed > 0
      ? Math.ceil(typed / line.packageSize)
      : null;
  const errorId = `qty-${line.materialId}-error`;

  return (
    <div className="border-b border-border px-3 py-3 last:border-b-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-primary">{line.name}</p>
          {packages != null && line.packageName != null && (
            <p className="mt-0.5 text-xs text-muted">
              {t('materials.packages', {
                qty: packages,
                packageName: line.packageName,
                size: formatNumber(line.packageSize, 3),
                unit: t('units.' + line.unit),
              })}
            </p>
          )}
          {invalid && (
            <p id={errorId} className="mt-1 text-xs text-danger">
              {t('materials.quantityInvalid')}
            </p>
          )}
        </div>
        <div className="flex w-28 flex-shrink-0 items-center gap-1">
          <Input
            inputMode="decimal"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={t('materials.quantityOf', { name: line.name })}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            className="text-right"
          />
          <span className="text-xs text-muted">{t('units.' + line.unit)}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={onToggle}
        className="mt-1 min-h-11 text-xs font-medium text-brand-700"
      >
        {open ? t('materials.hideMath') : t('materials.showMath')}
      </button>

      {open && (
        <div className="mt-1 space-y-1 rounded-xl bg-surface-sunken p-2">
          {line.sources.map((source, i) => (
            <SourceRow
              key={source.estimateItemId ?? String(i)}
              source={source}
              onSaved={onNormChange}
            />
          ))}
          <p className="border-t border-border pt-1 text-xs text-primary">
            {t('materials.mathTotal', {
              base: formatNumber(line.baseQuantity, 3),
              percent: line.wastePercent,
              total: formatNumber(line.quantity, 3),
              unit: t('units.' + line.unit),
            })}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * «Монтаж ГКЛ на стіни: 20 м² × 1 = 20». A PERIMETER norm says so, since 20 is not the area.
 *
 * The coefficient is editable here because a master who disagrees with our figure is usually right:
 * saving it forks the shipped norm into HIS OWN, which then wins in every later calculation. The
 * shared row is never written — that is why the write answers with a possibly DIFFERENT id, and why
 * this screen re-asks the server instead of scaling the figures it already has.
 */
function SourceRow({ source, onSaved }: { source: MaterialSourceLine; onSaved: () => void }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [rate, setRate] = useState(String(source.qtyPerUnit));

  const save = useMutation({
    mutationFn: (qtyPerUnit: number) => materialsApi.saveNorm(source.normId, { qtyPerUnit }),
    onSuccess: () => {
      setEditing(false);
      toast.success(t('materials.normSaved'));
      onSaved();
    },
    onError: () => toast.error(t('materials.normFailed')),
  });

  const restore = useMutation({
    mutationFn: () => materialsApi.restoreNorm(source.normId),
    onSuccess: () => {
      setEditing(false);
      toast.success(t('materials.normRestored'));
      onSaved();
    },
    onError: () => toast.error(t('materials.normFailed')),
  });

  const quantity = `${formatNumber(source.quantity, 3)} ${t('units.' + source.unit)}`;
  const basis = source.basis === 'PERIMETER' ? ` (${t('materials.perimeterSource')})` : '';
  // The master's own figure is shown as its own factor, so a mistyped розгортка or a thickness left
  // at our suggestion is visibly wrong here rather than hidden inside a total — it is the one
  // number on this row the estimate could not supply. `basis` decides the unit: a millimetre
  // rendered as a metre is the mistake the server-side rename of this field was guarding against.
  const param =
    source.param == null
      ? ''
      : source.basis === 'SECTION'
        ? ` × ${t('materials.sectionSource', { value: formatNumber(source.param, 3) })}`
        : source.basis === 'THICKNESS'
          ? ` × ${t('materials.thicknessSource', { value: formatNumber(source.param, 3) })}`
          : '';
  const busy = save.isPending || restore.isPending;

  const submit = () => {
    const parsed = rate.trim() ? parseDecimal(rate) : 0;
    if (!(parsed > 0)) {
      toast.error(t('materials.normInvalid'));
      return;
    }
    save.mutate(parsed);
  };

  return (
    <div>
      <p className="text-xs text-muted">
        {source.name ?? ''}
        {basis}: {quantity}
        {param} × {formatNumber(source.qtyPerUnit, 3)} ={' '}
        {formatNumber(source.amount, 3)}
        {source.ownNorm && (
          <span className="ml-1 rounded bg-brand-50 px-1 py-0.5 text-[10px] font-medium text-brand-700">
            {t('materials.normOwn')}
          </span>
        )}
      </p>

      {editing ? (
        <div className="mt-1 rounded-xl bg-surface p-2">
          <label className="mb-1 block text-xs font-medium text-muted">
            {t('materials.normLabel', { unit: t('units.' + source.unit) })}
            <Input
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="mt-1 text-right"
            />
          </label>
          <p className="text-[11px] text-muted">{t('materials.normHint')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button className="flex-1" loading={save.isPending} disabled={busy} onClick={submit}>
              {t('materials.normSave')}
            </Button>
            {source.ownNorm && (
              <Button
                variant="secondary"
                loading={restore.isPending}
                disabled={busy}
                onClick={() => restore.mutate()}
              >
                {t('materials.normRestore')}
              </Button>
            )}
            <Button variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setRate(String(source.qtyPerUnit));
            setEditing(true);
          }}
          className="min-h-11 text-xs font-medium text-brand-700"
        >
          {t('materials.normEdit')}
        </button>
      )}
    </div>
  );
}
