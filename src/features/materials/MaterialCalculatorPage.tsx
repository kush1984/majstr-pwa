import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  CoverageGap,
  MaterialLineRequest,
  MaterialSourceLine,
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
 * - what the calculator could NOT answer is said out loud, with the positions named. A coverage
 *   report that hides its gaps is worse than no calculator at all.
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

export function MaterialCalculatorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [waste, setWaste] = useState(10);
  const [perimeterInput, setPerimeterInput] = useState('');
  const [perimeter, setPerimeter] = useState<number | undefined>(undefined);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [gapsOpen, setGapsOpen] = useState(false);

  const calc = useQuery({
    queryKey: ['materials', id, waste, perimeter ?? null],
    queryFn: () => materialsApi.calculate(id, { wastePercent: waste, perimeter }),
    enabled: Boolean(id),
  });

  // The server re-rounds on every parameter change, so a figure typed against the old numbers
  // would silently claim to be «what the master left on the screen». Drop the overrides instead.
  useEffect(() => setEdited({}), [waste, perimeter]);

  const data = calc.data;
  const materials = useMemo(() => data?.materials ?? [], [data]);
  const needsPerimeter = (data?.parameters ?? []).length > 0;

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

        {calc.isError ? (
          <EmptyState icon="🧮" title={t('materials.errorTitle')} text={t('materials.loadError')} />
        ) : (
          <>
            {data && (
              <Coverage
                total={data.coverage.total}
                covered={data.coverage.covered}
                gaps={data.coverage.gaps}
                open={gapsOpen}
                onToggle={() => setGapsOpen((v) => !v)}
              />
            )}

            {data && !data.estimateSigned && (
              <p className="mb-4 rounded-card border border-border bg-surface px-3 py-2 text-xs text-muted">
                {t('materials.unsignedEstimate')}
              </p>
            )}

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
                    />
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setPerimeter(perimeterInput.trim() ? parseDecimal(perimeterInput) : undefined)
                    }
                  >
                    {t('materials.perimeterApply')}
                  </Button>
                </div>
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

            {materials.length === 0 ? (
              <EmptyState
                icon="🧮"
                title={t('materials.emptyTitle')}
                text={t('materials.emptyText')}
              />
            ) : (
              <div className="overflow-hidden rounded-card border border-border bg-surface">
                {materials.map((line) => (
                  <MaterialRow
                    key={line.materialId}
                    line={line}
                    value={edited[line.materialId] ?? String(line.quantity)}
                    onChange={(v) => setEdited((prev) => ({ ...prev, [line.materialId]: v }))}
                    open={openRow === line.materialId}
                    onToggle={() =>
                      setOpenRow((cur) => (cur === line.materialId ? null : line.materialId))
                    }
                    onNormChange={afterNormChange}
                  />
                ))}
              </div>
            )}
          </>
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
              disabled={toShoppingList.isPending || nothingPicked}
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
 * The coverage report. It is amber whenever anything is missing, and the missing positions are
 * NAMED — «порахували 8 з 11» with the three hidden is the failure this screen exists to avoid.
 */
function Coverage({
  total,
  covered,
  gaps,
  open,
  onToggle,
}: {
  total: number;
  covered: number;
  gaps: CoverageGap[];
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const clean = gaps.length === 0;

  return (
    <div
      className={
        clean
          ? 'mb-4 rounded-card border border-border bg-surface p-3'
          : 'mb-4 rounded-card border border-amber-300 bg-amber-50 p-3'
      }
    >
      <p className="text-sm font-semibold text-primary">
        {t('materials.coverage', { covered, total })}
      </p>
      {!clean && (
        <>
          <p className="mt-1 text-xs text-amber-800">{t('materials.coverageHint')}</p>
          <button
            type="button"
            onClick={onToggle}
            className="mt-2 min-h-11 text-sm font-medium text-brand-700"
          >
            {open ? t('materials.hideGaps') : t('materials.showGaps')}
          </button>
          {open && (
            <ul className="mt-1 space-y-1">
              {gaps.map((gap) => (
                <li key={gap.estimateItemId} className="text-xs text-amber-900">
                  · {gap.name} — {formatNumber(gap.quantity, 3)} {t('units.' + gap.unit)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
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
  open,
  onToggle,
  onNormChange,
}: {
  line: CalculatedMaterialLine;
  value: string;
  onChange: (v: string) => void;
  open: boolean;
  onToggle: () => void;
  onNormChange: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="border-b border-border px-3 py-3 last:border-b-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-primary">{line.name}</p>
          {line.packages != null && line.packageName != null && (
            <p className="mt-0.5 text-xs text-muted">
              {t('materials.packages', {
                qty: line.packages,
                packageName: line.packageName,
                size: formatNumber(line.packageSize, 3),
                unit: t('units.' + line.unit),
              })}
            </p>
          )}
        </div>
        <div className="flex w-28 flex-shrink-0 items-center gap-1">
          <Input
            inputMode="decimal"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={t('materials.quantityOf', { name: line.name })}
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
        {basis}: {quantity} × {formatNumber(source.qtyPerUnit, 3)} ={' '}
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
