import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Select } from '@/components/Select.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { cn } from '@/lib/cn.ts';
import { routes } from '@/lib/config.ts';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { useMe } from '@/features/auth/useMe.ts';
import { CATALOG_KEY } from '@/features/catalog/useCatalog.ts';
import { TRADE_EMOJI } from '@/lib/labels.ts';
import { catalogImportApi } from '@/api/catalogImport.ts';
import { guessType, guessUnit, parsePrice } from './importParse.ts';
import type {
  CatalogImportParseResponse,
  DedupPolicy,
  ImportMapping,
  ItemType,
  Trade,
  Unit,
} from '@/api/types.ts';

const UNITS: Unit[] = ['M2', 'M', 'LINEAR_METER', 'PIECE', 'KG', 'HOUR', 'SET', 'M3', 'T', 'POINT', 'PERCENT', 'KM'];

interface Draft {
  key: number;
  gridRow: number;
  name: string;
  unit: Unit | '';
  price: string;
  type: ItemType;
  include: boolean;
  issues: string[];
}

let keySeq = 0;
function toDrafts(rows: CatalogImportParseResponse['rows']): Draft[] {
  return rows.map((r) => ({
    key: keySeq++,
    gridRow: r.gridRow,
    name: r.name,
    unit: r.unit ?? '',
    price: r.price != null ? String(r.price) : '',
    type: r.type,
    include: true,
    issues: r.issues,
  }));
}

export function CatalogImportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<'source' | 'review'>('source');
  const [busy, setBusy] = useState(false);
  const [pasted, setPasted] = useState('');
  const [parsed, setParsed] = useState<CatalogImportParseResponse | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>({ nameCol: null, priceCol: null, unitCol: null });
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [trade, setTrade] = useState<Trade | ''>('');
  const [dedup, setDedup] = useState<DedupPolicy>('UPDATE_PRICE');

  const tradeOptions = useMemo(() => {
    const set = [...(me?.trades ?? [])];
    if (!set.includes('OTHER')) set.push('OTHER');
    return set;
  }, [me]);

  const onParsed = (res: CatalogImportParseResponse) => {
    if (res.rows.length === 0) {
      toast.error(t('import.emptyResult'));
      return;
    }
    setParsed(res);
    setMapping(res.guessedMapping);
    setDrafts(toDrafts(res.rows));
    // One trade → auto-select; else leave for the master to pick (defaults OTHER at commit).
    setTrade((me?.trades?.length ?? 0) === 1 ? me!.trades[0] : '');
    setStep('review');
  };

  const runParse = async (fn: () => Promise<CatalogImportParseResponse>) => {
    setBusy(true);
    try {
      onParsed(await fn());
    } catch (err) {
      toast.error(toAppError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (file) void runParse(() => catalogImportApi.parseFile(file));
  };

  // Re-derive rows locally when the master reassigns a column (no re-upload).
  const remap = (next: ImportMapping) => {
    setMapping(next);
    if (!parsed) return;
    const derived: Draft[] = parsed.grid
      .map((row, gridRow) => {
        const name = (next.nameCol != null ? row[next.nameCol] : '') ?? '';
        if (!name.trim()) return null;
        const unit = next.unitCol != null ? guessUnit(row[next.unitCol]) : null;
        const price = next.priceCol != null ? parsePrice(row[next.priceCol]) : null;
        const issues = [...(price == null ? ['price'] : []), ...(unit == null ? ['unit'] : [])];
        return {
          key: keySeq++,
          gridRow,
          name: name.trim(),
          unit: unit ?? '',
          price: price != null ? String(price) : '',
          type: guessType(name),
          include: true,
          issues,
        } as Draft;
      })
      .filter((d): d is Draft => d !== null);
    setDrafts(derived);
  };

  const patch = (key: number, next: Partial<Draft>) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...next } : d)));

  const included = drafts.filter((d) => d.include);
  const invalidCount = included.filter((d) => !d.name.trim() || !d.unit || parsePrice(d.price) == null).length;

  const commit = async () => {
    if (invalidCount > 0) {
      toast.error(t('import.fixHighlighted'));
      return;
    }
    setBusy(true);
    try {
      const res = await catalogImportApi.commit({
        items: included.map((d) => ({
          name: d.name.trim(),
          unit: d.unit as Unit,
          price: parsePrice(d.price)!,
          type: d.type,
          policy: null,
        })),
        trade: trade === '' ? null : trade,
        defaultPolicy: dedup,
      });
      qc.invalidateQueries({ queryKey: CATALOG_KEY });
      toast.success(t('import.done', { created: res.created, updated: res.updated, skipped: res.skipped }));
      navigate(routes.catalog);
    } catch (err) {
      toast.error(toAppError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const colOptions = parsed
    ? Array.from({ length: parsed.grid.reduce((m, r) => Math.max(m, r.length), 0) }, (_, i) => i)
    : [];
  const sample = (col: number | null) =>
    col == null || !parsed ? '' : (parsed.grid.find((r) => (r[col] ?? '').trim())?.[col] ?? '');

  return (
    <div className="min-h-dvh bg-canvas">
      <div className="mx-auto max-w-2xl px-4 pb-28 pt-4 sm:px-6">
        <div className="mb-5 flex items-center gap-3">
          <button
            type="button"
            aria-label={t('common.back')}
            onClick={() => (step === 'review' ? setStep('source') : navigate(routes.catalog))}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-sunken text-lg text-primary"
          >
            ←
          </button>
          <h1 className="text-xl font-extrabold tracking-tight text-primary">{t('import.title')}</h1>
        </div>

        {busy && step === 'source' ? (
          <div className="py-16 text-center">
            <Spinner />
            <p className="mt-3 text-sm text-muted">{t('import.parsing')}</p>
          </div>
        ) : step === 'source' ? (
          <div className="space-y-5">
            <p className="text-sm text-secondary">{t('import.intro')}</p>

            <div className="rounded-card border border-border bg-surface p-4">
              <h2 className="mb-1 text-sm font-bold text-primary">{t('import.uploadTitle')}</h2>
              <p className="mb-3 text-xs text-muted">{t('import.uploadHint')}</p>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={onFile}
              />
              <Button fullWidth variant="secondary" onClick={() => fileRef.current?.click()}>
                {t('import.chooseFile')}
              </Button>
            </div>

            <div className="rounded-card border border-border bg-surface p-4">
              <h2 className="mb-1 text-sm font-bold text-primary">{t('import.pasteTitle')}</h2>
              <p className="mb-3 text-xs text-muted">{t('import.pasteHint')}</p>
              <textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                rows={6}
                placeholder={t('import.pastePlaceholder')}
                className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
              />
              <Button
                fullWidth
                className="mt-2"
                disabled={!pasted.trim()}
                onClick={() => void runParse(() => catalogImportApi.parseText(pasted))}
              >
                {t('import.recognize')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {parsed && parsed.skippedRows > 0 && (
              <p className="text-xs text-muted">{t('import.skipped', { count: parsed.skippedRows })}</p>
            )}

            {/* Column remap — when the parser guessed wrong the master reassigns here. */}
            {colOptions.length >= 2 && (
              <div className="rounded-xl border border-border bg-surface p-3">
                <p className="mb-2 text-xs font-semibold text-muted">{t('import.columns')}</p>
                <div className="grid grid-cols-3 gap-2">
                  {(['nameCol', 'priceCol', 'unitCol'] as const).map((field) => (
                    <label key={field} className="block text-xs">
                      <span className="mb-1 block text-muted">{t(`import.col.${field}`)}</span>
                      <Select
                        value={mapping[field] ?? ''}
                        onChange={(e) =>
                          remap({ ...mapping, [field]: e.target.value === '' ? null : Number(e.target.value) })
                        }
                      >
                        <option value="">—</option>
                        {colOptions.map((c) => (
                          <option key={c} value={c}>
                            {`#${c + 1}: ${String(sample(c)).slice(0, 16)}`}
                          </option>
                        ))}
                      </Select>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {(me?.trades?.length ?? 0) >= 2 && (
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-muted">{t('import.tradeLabel')}</span>
                <Select value={trade} onChange={(e) => setTrade(e.target.value as Trade | '')}>
                  <option value="">{t('catalog.otherTrade')}</option>
                  {tradeOptions.map((tr) => (
                    <option key={tr} value={tr}>
                      {TRADE_EMOJI[tr]} {t('trades.' + tr)}
                    </option>
                  ))}
                </Select>
              </label>
            )}

            <div>
              <span className="mb-1 block text-xs font-semibold text-muted">{t('import.dedupLabel')}</span>
              <div className="flex gap-2">
                {(['UPDATE_PRICE', 'SKIP'] as DedupPolicy[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setDedup(p)}
                    className={cn(
                      'flex-1 rounded-lg border py-2 text-xs font-semibold',
                      dedup === p ? 'border-brand bg-brand-soft text-primary' : 'border-border text-muted',
                    )}
                  >
                    {t(p === 'UPDATE_PRICE' ? 'import.dedupUpdate' : 'import.dedupSkip')}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              {drafts.map((d) => {
                const bad = d.include && (!d.name.trim() || !d.unit || parsePrice(d.price) == null);
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
                        placeholder={t('import.col.nameCol')}
                      />
                      <button
                        type="button"
                        aria-label={t('import.removeRow')}
                        onClick={() => patch(d.key, { include: !d.include })}
                        className="mt-1 flex-shrink-0 text-lg text-muted"
                      >
                        {d.include ? '🗑' : '↩'}
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2">
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
                        onClick={() =>
                          patch(d.key, { type: d.type === 'WORK' ? 'MATERIAL' : 'WORK' })
                        }
                        className="rounded-lg border border-border px-2 text-xs font-semibold text-primary"
                      >
                        {t('itemType.' + d.type)}
                      </button>
                    </div>
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
              <p className="mb-1.5 text-center text-xs text-amber-600">
                {t('import.fixHighlighted')}
              </p>
            )}
            <Button fullWidth loading={busy} disabled={included.length === 0} onClick={commit}>
              {t('import.importN', { count: included.length })}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
