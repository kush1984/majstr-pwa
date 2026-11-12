import { useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/Button.tsx';
import { Checkbox } from '@/components/Checkbox.tsx';
import { Input } from '@/components/Input.tsx';
import { Select } from '@/components/Select.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { UpgradeBanner } from '@/components/UpgradeBanner.tsx';
import { cn } from '@/lib/cn.ts';
import { routes } from '@/lib/config.ts';
import { formatMoney } from '@/lib/format.ts';
import { TRADE_EMOJI } from '@/lib/labels.ts';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { transferApi } from '@/api/transfer.ts';
import { useMe, ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { useProjects } from '@/features/projects/useProjects.ts';
import { CATALOG_KEY } from '@/features/catalog/useCatalog.ts';
import { TEMP_FREE_GETS_ESTIMATE_IMPORT } from '@/features/plan/tempFreeUnlocks.ts';
import type {
  Trade,
  TransferCommitRequest,
  TransferCommitResponse,
  TransferDocumentKind,
  TransferLine,
  TransferParseResponse,
  Unit,
} from '@/api/types.ts';

/** A pile of a few dozen files is a whole history; more than this is better sent to us. */
export const MAX_TRANSFER_FILES = 20;

type Choice = TransferDocumentKind | 'SKIP';

/** One file on the review: what it was read as, and what the master decided for it. */
export interface TransferCard {
  key: number;
  fileName: string;
  parsed: TransferParseResponse | null;
  error: string | null;
  choice: Choice;
  /** '' = a new object named `objectName`; otherwise an existing object's id. */
  projectId: string;
  objectName: string;
  estimateName: string;
  toCatalog: boolean;
}

/** The lines a card can actually send: a line with no unit cannot be saved, so it stays behind. */
export function usableLines(lines: TransferLine[]): (TransferLine & { unit: Unit })[] {
  return lines.filter((l): l is TransferLine & { unit: Unit } => l.unit != null && l.name.trim() !== '');
}

/** The new object a file is going to, by default: the name the paper gives, else the file's own. */
export function defaultObjectName(parsed: TransferParseResponse, fileName: string): string {
  return parsed.objectName?.trim() || parsed.address?.trim() || fileName.replace(/\.[^.]+$/, '');
}

/** The confirmed review as the commit request — price lists to the catalog, estimates to objects. */
export function toCommitRequest(cards: TransferCard[], updatePrices: boolean): TransferCommitRequest {
  const priceLists: TransferCommitRequest['priceLists'] = [];
  const estimates: TransferCommitRequest['estimates'] = [];
  for (const c of cards) {
    if (!c.parsed || c.choice === 'SKIP') continue;
    const lines = usableLines(c.parsed.items);
    if (lines.length === 0) continue;
    if (c.choice === 'PRICE_LIST') {
      priceLists.push({
        items: lines.map((l) => ({
          name: l.name.trim(), unit: l.unit, price: l.unitPrice ?? 0, type: l.type,
          trade: l.trade, category: l.category,
        })),
      });
    } else {
      estimates.push({
        projectId: c.projectId || null,
        objectName: c.projectId ? null : c.objectName.trim(),
        address: c.projectId ? null : c.parsed.address,
        clientName: c.projectId ? null : c.parsed.clientName,
        estimateName: c.estimateName.trim() || null,
        depositAmount: c.parsed.depositAmount,
        toCatalog: c.toCatalog,
        items: lines.map((l) => ({
          name: l.name.trim(), unit: l.unit, quantity: l.quantity ?? 0, unitPrice: l.unitPrice ?? 0,
          type: l.type, section: l.section, trade: l.trade, category: l.category,
        })),
      });
    }
  }
  return { priceLists, estimates, defaultPolicy: updatePrices ? 'UPDATE_PRICE' : 'SKIP' };
}

let keySeq = 0;

/**
 * «Перенести в Majstr» — a master's existing estimates and price lists, many files at once.
 *
 * <p>Each file is read on its own (one bad file costs only itself) and comes back as either a price
 * list, which goes to the catalog, or an estimate, which goes to an object — a new one the paper
 * names, or one he already has. Every position arrives filed under a trade by the server; nothing
 * is written until «Перенести», and then all of it in one transaction.</p>
 */
export function TransferPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: projects } = useProjects();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'source' | 'reading' | 'review' | 'done'>('source');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [cards, setCards] = useState<TransferCard[]>([]);
  const [updatePrices, setUpdatePrices] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<TransferCommitResponse | null>(null);

  const allowed = (me?.plan ?? 'FREE') !== 'FREE' || TEMP_FREE_GETS_ESTIMATE_IMPORT;

  const onFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (picked.length === 0) return;
    if (picked.length > MAX_TRANSFER_FILES) {
      toast.info(t('transfer.tooManyFiles', { max: MAX_TRANSFER_FILES }));
    }
    const files = picked.slice(0, MAX_TRANSFER_FILES);
    setStep('reading');
    setProgress({ done: 0, total: files.length });
    const read: TransferCard[] = [];
    for (const [i, file] of files.entries()) {
      try {
        const parsed = await transferApi.parseFile(file);
        read.push({
          key: keySeq++, fileName: file.name, parsed, error: null,
          choice: parsed.items.length === 0 ? 'SKIP' : parsed.kind,
          projectId: '', objectName: defaultObjectName(parsed, file.name),
          estimateName: parsed.title ?? '', toCatalog: true,
        });
      } catch (err) {
        read.push({
          key: keySeq++, fileName: file.name, parsed: null, error: toAppError(err).message,
          choice: 'SKIP', projectId: '', objectName: '', estimateName: '', toCatalog: true,
        });
      }
      setProgress({ done: i + 1, total: files.length });
    }
    setCards((prev) => [...prev, ...read]);
    setStep('review');
  };

  const patch = (key: number, next: Partial<TransferCard>) =>
    setCards((prev) => prev.map((c) => (c.key === key ? { ...c, ...next } : c)));

  const request = toCommitRequest(cards, updatePrices);
  const nothing = request.priceLists.length === 0 && request.estimates.length === 0;
  const missingObject = cards.some((c) => c.parsed && c.choice === 'ESTIMATE' && !c.projectId && !c.objectName.trim());

  const commit = async () => {
    setCommitting(true);
    try {
      const res = await transferApi.commit(request);
      void qc.invalidateQueries({ queryKey: ['projects'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['clients'] });
      void qc.invalidateQueries({ queryKey: CATALOG_KEY });
      void qc.invalidateQueries({ queryKey: ME_QUERY_KEY }); // his trades may have grown
      setResult(res);
      setStep('done');
    } catch (err) {
      toast.error(toAppError(err).message);
    } finally {
      setCommitting(false);
    }
  };

  const fileInputs = (
    <>
      <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => void onFiles(e)}
        accept=".pdf,application/pdf,.xlsx,.xls,.csv,image/jpeg,image/png,image/webp" />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => void onFiles(e)} />
    </>
  );

  return (
    <div className="min-h-dvh bg-canvas">
      <div className="mx-auto max-w-2xl px-4 pb-32 pt-4">
        <div className="mb-5 flex items-center gap-3">
          <button
            type="button"
            aria-label={t('common.back')}
            onClick={() => navigate(-1)}
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-sunken text-lg text-primary"
          >
            ←
          </button>
          <h1 className="text-xl font-extrabold tracking-tight text-primary">{t('transfer.title')}</h1>
        </div>
        {fileInputs}

        {!allowed ? (
          <UpgradeBanner text={t('estimateImport.proHint')} trigger="ESTIMATE_IMPORT" />
        ) : step === 'source' ? (
          <div className="space-y-4">
            <p className="text-sm text-secondary">{t('transfer.intro')}</p>
            <ul className="space-y-2 rounded-card border border-border bg-surface p-4 text-sm text-secondary">
              <li>💰 {t('transfer.whatPrice')}</li>
              <li>📄 {t('transfer.whatEstimate')}</li>
              <li>🏷️ {t('transfer.whatTrades')}</li>
            </ul>
            <p className="text-xs text-muted">{t('transfer.formats', { max: MAX_TRANSFER_FILES })}</p>
            <Button fullWidth className="min-h-[48px]" onClick={() => fileRef.current?.click()}>
              {t('transfer.chooseFiles')}
            </Button>
            <Button fullWidth variant="secondary" onClick={() => cameraRef.current?.click()}>
              {t('transfer.takePhoto')}
            </Button>
          </div>
        ) : step === 'reading' ? (
          <div className="py-16 text-center">
            <Spinner />
            <p className="mt-3 text-sm text-muted">
              {t('transfer.reading', { done: progress.done + 1 > progress.total ? progress.total : progress.done + 1, total: progress.total })}
            </p>
            <p className="mt-1 text-xs text-faint">{t('transfer.readingHint')}</p>
          </div>
        ) : step === 'review' ? (
          <div className="space-y-3">
            <p className="text-sm text-secondary">{t('transfer.reviewHint')}</p>
            {cards.map((c) => (
              <TransferCardView key={c.key} card={c} projects={projects ?? []} onChange={(n) => patch(c.key, n)} />
            ))}
            <button type="button" onClick={() => fileRef.current?.click()}
              className="min-h-[44px] w-full rounded-card border border-dashed border-brand/50 text-sm font-semibold text-brand">
              {t('transfer.addMore')}
            </button>
            <Checkbox label={t('transfer.updatePrices')} checked={updatePrices}
              onChange={() => setUpdatePrices((v) => !v)} />
            <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3">
              <div className="mx-auto max-w-2xl">
                {missingObject && <p className="mb-2 text-xs text-danger">{t('transfer.nameTheObject')}</p>}
                <Button fullWidth className="min-h-[48px]" loading={committing}
                  disabled={nothing || missingObject} onClick={() => void commit()}>
                  {t('transfer.commit')}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          result && (
            <div className="space-y-4 py-6 text-center">
              <div className="text-4xl">✅</div>
              <h2 className="text-lg font-bold text-primary">{t('transfer.doneTitle')}</h2>
              <p className="text-sm text-secondary">
                {t('transfer.doneObjects', { objects: result.objectsCreated, estimates: result.estimatesCreated })}
              </p>
              <p className="text-sm text-secondary">
                {t('transfer.doneCatalog', {
                  created: result.catalogCreated, updated: result.catalogUpdated, skipped: result.catalogSkipped,
                })}
              </p>
              <div className="flex flex-col gap-2 pt-2">
                <Button fullWidth onClick={() => void navigate(routes.projects)}>{t('transfer.toObjects')}</Button>
                <Button fullWidth variant="secondary" onClick={() => void navigate(routes.catalog)}>
                  {t('transfer.toCatalog')}
                </Button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function TransferCardView({ card, projects, onChange }: {
  card: TransferCard;
  projects: { id: string; name: string }[];
  onChange: (next: Partial<TransferCard>) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  if (!card.parsed) {
    return (
      <div className="rounded-card border border-danger/30 bg-surface p-3">
        <div className="truncate text-sm font-semibold text-primary">📎 {card.fileName}</div>
        <p className="mt-1 text-xs text-danger">{card.error ?? t('transfer.unreadable')}</p>
      </div>
    );
  }

  const lines = card.parsed.items;
  const usable = usableLines(lines);
  const sum = usable.reduce((s, l) => s + (l.quantity ?? 0) * (l.unitPrice ?? 0), 0);
  const unfiled = lines.length - usable.length;
  const trades = new Map<Trade | null, number>();
  for (const l of usable) trades.set(l.trade, (trades.get(l.trade) ?? 0) + 1);

  return (
    <div className={cn('rounded-card border bg-surface p-3', card.choice === 'SKIP' ? 'border-border opacity-70' : 'border-brand/30')}>
      <div className="truncate text-sm font-semibold text-primary">📎 {card.fileName}</div>
      <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-surface-sunken p-1" role="radiogroup"
        aria-label={t('transfer.kindLabel')}>
        {(['ESTIMATE', 'PRICE_LIST', 'SKIP'] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={card.choice === k}
            onClick={() => onChange({ choice: k })}
            className={cn('min-h-[40px] rounded-md text-xs font-semibold',
              card.choice === k ? 'bg-surface text-primary shadow-card' : 'text-muted')}>
            {t(`transfer.kind.${k}`)}
          </button>
        ))}
      </div>

      {card.choice === 'ESTIMATE' && (
        <div className="mt-3 space-y-2">
          <label className="block text-xs font-semibold text-muted">
            {t('transfer.object')}
            <Select className="mt-1" value={card.projectId} onChange={(e) => onChange({ projectId: e.target.value })}>
              <option value="">{t('transfer.newObject')}</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </label>
          {!card.projectId && (
            <Input aria-label={t('transfer.objectName')} placeholder={t('transfer.objectName')}
              value={card.objectName} onChange={(e) => onChange({ objectName: e.target.value })} />
          )}
          {!card.projectId && card.parsed.clientName && (
            <p className="text-xs text-muted">{t('transfer.client', { name: card.parsed.clientName })}</p>
          )}
          <Input aria-label={t('transfer.estimateName')} placeholder={t('transfer.estimateName')}
            value={card.estimateName} onChange={(e) => onChange({ estimateName: e.target.value })} />
          <Checkbox label={t('transfer.alsoToCatalog')} checked={card.toCatalog}
            onChange={() => onChange({ toCatalog: !card.toCatalog })} />
        </div>
      )}

      {card.choice !== 'SKIP' && (
        <>
          <p className="mt-3 text-sm text-secondary">
            {card.choice === 'ESTIMATE'
              ? t('transfer.estimateSummary', { count: usable.length, sum: formatMoney(sum) })
              : t('transfer.priceSummary', { count: usable.length })}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {[...trades.entries()].map(([trade, n]) => (
              <span key={trade ?? 'none'} className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] text-secondary">
                {trade ? `${TRADE_EMOJI[trade]} ${t(`trades.${trade}`)}` : t('transfer.otherTrade')} · {n}
              </span>
            ))}
          </div>
          {unfiled > 0 && <p className="mt-1.5 text-xs text-amber-strong">{t('transfer.noUnit', { count: unfiled })}</p>}
          <button type="button" onClick={() => setOpen((v) => !v)}
            className="mt-1 min-h-[40px] text-xs font-semibold text-brand">
            {open ? t('transfer.hideLines') : t('transfer.showLines')}
          </button>
          {open && (
            <ul className="mt-1 max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border text-xs">
              {lines.map((l, i) => (
                <li key={i} className={cn('px-2.5 py-2', l.unit == null && 'opacity-50')}>
                  <div className="text-primary">{l.name}</div>
                  <div className="text-muted">
                    {card.choice === 'ESTIMATE' ? `${l.quantity ?? 0} ${l.unit ? t(`units.${l.unit}`) : '?'} × ` : ''}
                    {formatMoney(l.unitPrice ?? 0)}
                    {l.trade && ` · ${TRADE_EMOJI[l.trade]} ${t(`trades.${l.trade}`)}`}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
