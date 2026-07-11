import { useRef, useState, type ChangeEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Select } from '@/components/Select.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { FormField } from '@/components/FormField.tsx';
import { UpgradeBanner } from '@/components/UpgradeBanner.tsx';
import { cn } from '@/lib/cn.ts';
import { routes } from '@/lib/config.ts';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { parseDecimal } from '@/lib/decimal.ts';
import { useMe } from '@/features/auth/useMe.ts';
import { CATALOG_KEY } from '@/features/catalog/useCatalog.ts';
import { estimateImportApi } from '@/api/estimateImport.ts';
import type {
  DedupPolicy,
  EstimateImportParseResponse,
  ItemType,
  Unit,
} from '@/api/types.ts';

const UNITS: Unit[] = ['M2', 'M', 'LINEAR_METER', 'PIECE', 'KG', 'HOUR', 'SET', 'M3', 'T', 'POINT', 'PERCENT', 'KM'];

interface Draft {
  key: number;
  name: string;
  unit: Unit | '';
  quantity: string;
  price: string;
  type: ItemType;
  category: string;
  include: boolean; // in the estimate
  toCatalog: boolean; // also add/keep in the catalog
  issues: string[];
}

let keySeq = 0;
function toDrafts(items: EstimateImportParseResponse['items']): Draft[] {
  return items.map((it) => ({
    key: keySeq++,
    name: it.name,
    unit: it.unit ?? '',
    quantity: it.quantity != null ? String(it.quantity) : '',
    price: it.unitPrice != null ? String(it.unitPrice) : '',
    type: it.type,
    category: it.category ?? '',
    include: true,
    toCatalog: true,
    issues: it.issues,
  }));
}

const num = (s: string): number => (s.trim() ? parseDecimal(s) : 0);

export function EstimateImportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [params] = useSearchParams();
  const projectId = params.get('projectId') ?? '';
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<'source' | 'review'>('source');
  const [busy, setBusy] = useState(false);
  const [estName, setEstName] = useState('');
  const [deposit, setDeposit] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  // Global conflict rule for catalog upsert (master decides on review): a ticked
  // position that already exists in the catalog is either price-updated or left as-is.
  const [catalogPolicy, setCatalogPolicy] = useState<DedupPolicy>('SKIP');

  const isPro = (me?.plan ?? 'FREE') !== 'FREE';

  const back = () => {
    if (step === 'review') {
      setStep('source');
      return;
    }
    navigate(projectId ? routes.project(projectId) : routes.projects);
  };

  const onParsed = (res: EstimateImportParseResponse) => {
    if (res.items.length === 0) {
      toast.error(t('estimateImport.emptyResult'));
      return;
    }
    setDrafts(toDrafts(res.items));
    setDeposit(res.depositAmount != null ? String(res.depositAmount) : '');
    setStep('review');
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setBusy(true);
    estimateImportApi
      .parseFile(file)
      .then(onParsed)
      .catch((err) => toast.error(toAppError(err).message))
      .finally(() => setBusy(false));
  };

  const patch = (key: number, next: Partial<Draft>) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...next } : d)));

  const included = drafts.filter((d) => d.include);
  // Only name + unit are required. Quantity / price may be 0 — a master often knows
  // the unit price but not yet the count (e.g. how many fixtures); the line total is
  // 0 until a quantity is set. So 0/empty here is allowed, not a validation error.
  const isBad = (d: Draft) => !d.name.trim() || !d.unit;
  const invalidCount = included.filter(isBad).length;

  const commit = async () => {
    if (included.length === 0) return;
    if (invalidCount > 0) {
      toast.error(t('estimateImport.fixHighlighted'));
      return;
    }
    setBusy(true);
    try {
      const res = await estimateImportApi.commit({
        projectId,
        estimateName: estName.trim() || undefined,
        depositAmount: deposit.trim() ? parseDecimal(deposit) : null,
        items: included.map((d) => ({
          name: d.name.trim(),
          unit: d.unit as Unit,
          quantity: num(d.quantity),
          unitPrice: num(d.price),
          type: d.type,
          category: d.category.trim() || null,
          toCatalog: d.toCatalog,
          catalogPolicy: d.toCatalog ? catalogPolicy : null,
        })),
      });
      qc.invalidateQueries({ queryKey: ['project-estimates', projectId] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: CATALOG_KEY });
      toast.success(t('estimateImport.done'));
      navigate(routes.estimate(res.estimateId), { replace: true });
    } catch (err) {
      toast.error(toAppError(err).message);
      setBusy(false);
    }
  };

  const header = (
    <div className="mb-5 flex items-center gap-3">
      <button
        type="button"
        aria-label={t('common.back')}
        onClick={back}
        className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-sunken text-lg text-primary"
      >
        ←
      </button>
      <h1 className="text-xl font-extrabold tracking-tight text-primary">{t('estimateImport.title')}</h1>
    </div>
  );

  // No target object (shouldn't happen via the entry points) — bail gracefully.
  if (!projectId) {
    return (
      <div className="min-h-dvh bg-canvas">
        <div className="mx-auto max-w-2xl px-4 pb-28 pt-4 sm:px-6">
          {header}
          <p className="text-sm text-secondary">{t('estimateImport.noObject')}</p>
          <Button className="mt-4" onClick={() => navigate(routes.projects)}>
            {t('projects.toList')}
          </Button>
        </div>
      </div>
    );
  }

  // PRO gate: FREE sees the pitch + upsell, no upload (backend enforces it too).
  if (!isPro) {
    return (
      <div className="min-h-dvh bg-canvas">
        <div className="mx-auto max-w-2xl px-4 pb-28 pt-4 sm:px-6">
          {header}
          <div className="rounded-card border border-border bg-surface p-4">
            <div className="mb-2 text-3xl">📄→🧾</div>
            <h2 className="mb-1 text-base font-bold text-primary">{t('estimateImport.proTitle')}</h2>
            <p className="mb-4 text-sm text-secondary">{t('estimateImport.proPitch')}</p>
            <UpgradeBanner text={t('estimateImport.proHint')} trigger="ESTIMATE_IMPORT" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <div className="mx-auto max-w-2xl px-4 pb-28 pt-4 sm:px-6">
        {header}

        {busy && step === 'source' ? (
          <div className="py-16 text-center">
            <Spinner />
            <p className="mt-3 text-sm text-muted">{t('estimateImport.parsing')}</p>
          </div>
        ) : step === 'source' ? (
          <div className="space-y-5">
            <p className="text-sm text-secondary">{t('estimateImport.intro')}</p>

            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv,image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={onFile}
            />
            {/* Camera capture (mobile): opens the rear camera to shoot the estimate. */}
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={onFile}
            />

            <div className="rounded-card border border-border bg-surface p-4">
              <h2 className="mb-1 text-sm font-bold text-primary">{t('estimateImport.uploadTitle')}</h2>
              <p className="mb-3 text-xs text-muted">{t('estimateImport.uploadHint')}</p>
              {/* Stack on a phone (full-width taps, no label wrap), side-by-side on ≥sm. */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button fullWidth variant="secondary" onClick={() => fileRef.current?.click()}>
                  {t('estimateImport.chooseFile')}
                </Button>
                <Button fullWidth variant="secondary" onClick={() => cameraRef.current?.click()}>
                  {t('estimateImport.takePhoto')}
                </Button>
              </div>
            </div>

            <p className="text-xs text-muted">{t('estimateImport.privacyNote')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Estimate name + deposit. */}
            <div className="space-y-3 rounded-card border border-border bg-surface p-3.5">
              <FormField label={t('estimate.nameLabel')} htmlFor="imp-name" hint={t('estimate.nameHint')}>
                <Input
                  id="imp-name"
                  maxLength={255}
                  placeholder={t('estimate.namePlaceholder')}
                  value={estName}
                  onChange={(e) => setEstName(e.target.value)}
                />
              </FormField>
              <FormField label={t('estimateImport.depositLabel')} htmlFor="imp-deposit">
                <Input
                  id="imp-deposit"
                  inputMode="decimal"
                  placeholder="₴"
                  value={deposit}
                  onChange={(e) => setDeposit(e.target.value)}
                />
              </FormField>
            </div>

            {/* Global catalog-conflict rule for the ticked positions. */}
            <div>
              <span className="mb-1 block text-xs font-semibold text-muted">{t('estimateImport.dedupLabel')}</span>
              <div className="flex gap-2">
                {(['SKIP', 'UPDATE_PRICE'] as DedupPolicy[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setCatalogPolicy(p)}
                    className={cn(
                      'flex-1 rounded-lg border py-2 text-xs font-semibold',
                      catalogPolicy === p ? 'border-brand bg-brand-soft text-primary' : 'border-border text-muted',
                    )}
                  >
                    {t(p === 'UPDATE_PRICE' ? 'import.dedupUpdate' : 'import.dedupSkip')}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-xs text-muted">{t('estimateImport.reviewHint')}</p>

            <div className="space-y-2">
              {drafts.map((d) => {
                const bad = d.include && isBad(d);
                return (
                  <div
                    key={d.key}
                    className={cn(
                      'rounded-xl border p-3',
                      !d.include
                        ? 'border-border bg-surface-sunken opacity-50'
                        : bad
                          ? 'border-amber-400 bg-amber-50'
                          : 'border-border bg-surface',
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <Input
                        value={d.name}
                        onChange={(e) => patch(d.key, { name: e.target.value })}
                        className="flex-1"
                        placeholder={t('estimateImport.namePlaceholder')}
                      />
                      <button
                        type="button"
                        aria-label={t('estimateImport.removeRow')}
                        onClick={() => patch(d.key, { include: !d.include })}
                        className="mt-1 flex-shrink-0 text-lg text-muted"
                      >
                        {d.include ? '🗑' : '↩'}
                      </button>
                    </div>

                    {/* 2×2 on phones (comfortable tap targets), not four cramped columns:
                        row 1 = quantity + unit, row 2 = price + type toggle. */}
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Input
                        value={d.quantity}
                        inputMode="decimal"
                        onChange={(e) => patch(d.key, { quantity: e.target.value })}
                        placeholder={t('estimateImport.qtyPlaceholder')}
                      />
                      <Select value={d.unit} onChange={(e) => patch(d.key, { unit: e.target.value as Unit | '' })}>
                        <option value="">{t('import.pickUnit')}</option>
                        {UNITS.map((u) => (
                          <option key={u} value={u}>
                            {t('units.' + u)}
                          </option>
                        ))}
                      </Select>
                      <Input
                        value={d.price}
                        inputMode="decimal"
                        onChange={(e) => patch(d.key, { price: e.target.value })}
                        placeholder="₴"
                      />
                      <button
                        type="button"
                        onClick={() => patch(d.key, { type: d.type === 'WORK' ? 'MATERIAL' : 'WORK' })}
                        className="w-full rounded-lg border border-border px-3 py-2.5 text-sm font-semibold text-primary"
                      >
                        {t('itemType.' + d.type)}
                      </button>
                    </div>

                    {d.include && (
                      <label className="mt-2 flex items-center gap-2 text-xs text-secondary">
                        <input
                          type="checkbox"
                          checked={d.toCatalog}
                          onChange={(e) => patch(d.key, { toCatalog: e.target.checked })}
                          className="h-4 w-4 rounded border-border text-brand focus:ring-brand-200"
                        />
                        {t('estimateImport.toCatalog')}
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {step === 'review' && (
        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-surface/95 p-3 backdrop-blur">
          <div className="mx-auto max-w-2xl">
            {invalidCount > 0 && (
              <p className="mb-1.5 text-center text-xs text-amber-600">{t('estimateImport.fixHighlighted')}</p>
            )}
            <Button fullWidth loading={busy} disabled={included.length === 0} onClick={commit}>
              {t('estimateImport.createN', { count: included.length })}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
