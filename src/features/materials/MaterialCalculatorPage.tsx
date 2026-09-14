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
import type {
  CalculatedMaterialLine,
  MaterialLineRequest,
  MaterialSourceLine,
  MissingParameter,
} from '@/api/types.ts';

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
 * A metre figure the master typed, or null when what he typed is not one.
 *
 * <p>«abc» parses to NaN, and NaN used to be applied and sent — the server answers 400, so the
 * screen blamed the connection for a typo and offered nothing to fix. The upper bound is a sanity
 * check rather than a rule of building: no room on this screen is a kilometre around, and a stray
 * extra digit is the mistake it actually catches.</p>
 */
const MAX_METRES = 1000;
function metres(raw: string): number | null {
  const value = parseDecimal(raw);
  return Number.isFinite(value) && value > 0 && value <= MAX_METRES ? value : null;
}

/**
 * A quantity the master typed over ours.
 *
 * <p>Blank is not an error — it is how he says «не це», and the row drops out of the list. Anything
 * that is not a positive number IS one, and used to be dropped just as silently: `parseDecimal('abc')`
 * is NaN, the payload filter removed it, and the rest went off to the shopping list. He found out at
 * the merchant, by the material not being on it.</p>
 */
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

  const [waste, setWaste] = useState(10);
  const [perimeterInput, setPerimeterInput] = useState('');
  const [perimeter, setPerimeter] = useState<number | undefined>(undefined);
  const [perimeterError, setPerimeterError] = useState(false);
  const [sectionInputs, setSectionInputs] = useState<Record<string, string>>({});
  const [sectionErrors, setSectionErrors] = useState<Record<string, boolean>>({});
  const [sections, setSections] = useState<string | undefined>(undefined);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [openRow, setOpenRow] = useState<string | null>(null);

  const calc = useQuery({
    queryKey: ['materials', id, waste, perimeter ?? null, sections ?? null],
    queryFn: () => materialsApi.calculate(id, { wastePercent: waste, perimeter, sections }),
    enabled: Boolean(id),
    // Every parameter change is a NEW key, so the whole screen used to collapse into a full-page
    // spinner — controls, figures and all — on each tap of the waste steps. Keeping the last answer
    // on screen turns that into a quiet recalculation of numbers he can watch move.
    placeholderData: keepPreviousData,
  });

  // The server re-rounds on every parameter change, so a figure typed against the old numbers
  // would silently claim to be «what the master left on the screen». Drop the overrides instead.
  useEffect(() => setEdited({}), [waste, perimeter, sections]);

  const data = calc.data;
  const materials = useMemo(() => data?.materials ?? [], [data]);

  // What the last SUCCESSFUL answer asked for. The parameters ride the query KEY, so a refused
  // request is a different query holding no data at all — and the perimeter/section cards would
  // disappear at exactly the moment the master needs them to correct the figure that was refused.
  const [askedFor, setAskedFor] = useState<MissingParameter[]>([]);
  useEffect(() => {
    if (data) setAskedFor(data.parameters);
  }, [data]);
  const parameters = useMemo(() => data?.parameters ?? askedFor, [data, askedFor]);
  const needsPerimeter = parameters.some((p) => p.parameter === 'PERIMETER');

  // One input per POSITION, not per material: a короб's board and its ribs share one розгортка, but
  // a короб and a ніша in the same estimate are different boxes and are asked for separately.
  const sectionPositions = useMemo(() => {
    const byPosition = new Map<string, string>();
    for (const p of parameters) {
      if (p.parameter !== 'SECTION' || !p.estimateItemId) continue;
      if (!byPosition.has(p.estimateItemId)) byPosition.set(p.estimateItemId, p.positionName ?? '');
    }
    return [...byPosition].map(([estimateItemId, name]) => ({ estimateItemId, name }));
  }, [parameters]);

  const applyPerimeter = () => {
    const raw = perimeterInput.trim();
    if (raw === '') {
      setPerimeterError(false);
      setPerimeter(undefined);
      return;
    }
    const value = metres(raw);
    if (value == null) {
      setPerimeterError(true);
      return;
    }
    setPerimeterError(false);
    setPerimeter(value);
  };

  // Each box answers for itself: one left blank keeps asking rather than borrowing a neighbour's.
  // An UNREADABLE box is not a blank one, though the old filter treated them alike and dropped it
  // — the card just kept asking, with nothing on screen saying why. Nothing is sent until every
  // figure actually typed is a figure.
  const applySections = () => {
    const errors: Record<string, boolean> = {};
    const entries: string[] = [];
    for (const [itemId, raw] of Object.entries(sectionInputs)) {
      if (raw.trim() === '') continue;
      const value = metres(raw);
      if (value == null) errors[itemId] = true;
      else entries.push(`${itemId}:${value}`);
    }
    setSectionErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSections(entries.length > 0 ? entries.join(',') : undefined);
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

        {!calc.isError && data && (
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
            <p className="text-sm font-semibold text-primary">{t('materials.perimeterTitle')}</p>
            <p className="mt-1 text-xs text-muted">{t('materials.perimeterHint')}</p>
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
                {t('materials.perimeterApply')}
              </Button>
            </div>
            {perimeterError && (
              <p id="perimeter-error" className="mt-1 text-xs text-danger">
                {t('materials.badNumber')}
              </p>
            )}
          </div>
        )}

        {sectionPositions.length > 0 && (
          <div className="mb-4 rounded-card border border-border bg-surface p-3">
            <p className="text-sm font-semibold text-primary">{t('materials.sectionTitle')}</p>
            <p className="mt-1 text-xs text-muted">{t('materials.sectionHint')}</p>
            <div className="mt-2 space-y-2">
              {sectionPositions.map((p) => (
                <div key={p.estimateItemId}>
                  <label
                    htmlFor={`section-${p.estimateItemId}`}
                    className="mb-1 block text-xs font-medium text-muted"
                  >
                    {p.name}
                  </label>
                  <Input
                    id={`section-${p.estimateItemId}`}
                    inputMode="decimal"
                    value={sectionInputs[p.estimateItemId] ?? ''}
                    onChange={(e) =>
                      setSectionInputs((prev) => ({
                        ...prev,
                        [p.estimateItemId]: e.target.value,
                      }))
                    }
                    placeholder={t('materials.sectionLabel')}
                    aria-invalid={sectionErrors[p.estimateItemId] || undefined}
                    aria-describedby={
                      sectionErrors[p.estimateItemId]
                        ? `section-${p.estimateItemId}-error`
                        : undefined
                    }
                  />
                  {sectionErrors[p.estimateItemId] && (
                    <p id={`section-${p.estimateItemId}-error`} className="mt-1 text-xs text-danger">
                      {t('materials.badNumber')}
                    </p>
                  )}
                </div>
              ))}
            </div>
            <Button variant="secondary" fullWidth className="mt-2" onClick={applySections}>
              {t('materials.sectionApply')}
            </Button>
          </div>
        )}

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

        {!calc.isError && materials.length === 0 && (
          <EmptyState icon="🧮" title={t('materials.emptyTitle')} text={t('materials.emptyText')} />
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
  // The section is shown as its own factor, so a mistyped розгортка is visibly wrong here rather
  // than hidden inside a total — it is the one figure on this row the estimate could not supply.
  const section =
    source.basis === 'SECTION' && source.section != null
      ? ` × ${t('materials.sectionSource', { value: formatNumber(source.section, 3) })}`
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
        {section} × {formatNumber(source.qtyPerUnit, 3)} ={' '}
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
