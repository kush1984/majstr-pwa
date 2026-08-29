import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Select } from '@/components/Select.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { UpgradeIntentModal } from '@/features/upgrade/UpgradeIntentModal.tsx';
import { useMe } from '@/features/auth/useMe.ts';
import { upgradeApi } from '@/api/upgrade.ts';
import { receiptImportApi } from '@/api/receiptImport.ts';
import { photosApi } from '@/api/photos.ts';
import { economyApi } from '@/api/economy.ts';
import { toast } from '@/hooks/useToast.ts';
import { useOnlineGuard } from '@/hooks/useOnlineGuard.ts';
import { toAppError } from '@/api/errors.ts';
import { parseDecimal } from '@/lib/decimal.ts';
import { formatMoney } from '@/lib/format.ts';
import { downscaleImage } from '@/lib/image.ts';
import { BATCH_QR_BUDGET_MS, decodeQrFromFile, looksFiscal } from '@/lib/qr.ts';
import { cn } from '@/lib/cn.ts';
import { ReceiptOrdinal, ReceiptPhoto } from '@/features/photos/ReceiptPhoto.tsx';
import { usePhotos } from '@/features/photos/usePhotos.ts';
import { usePlanLimits } from '@/features/plan/usePlanLimits.ts';
import { useInvalidateEstimate } from './useEstimate.ts';
import { UNITS } from '@/api/types.ts';
import type { ItemType, Unit } from '@/api/types.ts';

const MAX_BYTES = 10 * 1024 * 1024;

/** Parse a decimal field to a finite number, blank/garbage → 0 (master may fill later). */
function num(s: string): number {
  const n = parseDecimal(s);
  return Number.isFinite(n) ? n : 0;
}

interface Draft {
  key: number;
  /** Which of the picked photos this row came from — 1-based, shown as a divider in the review. */
  receipt: number;
  via: 'qr' | 'photo';
  name: string;
  quantity: string;
  price: string;
  unit: Unit | '';
  type: ItemType;
  include: boolean;
}

type Step = 'source' | 'parsing' | 'review';

/**
 * Add items to the open estimate from receipts — a pile of them in one gesture (receipts-batch).
 *
 * <p>There is no separate «read a QR» action any more. Every picked photo goes through the same
 * ladder: the fiscal code printed on the slip is decoded ON THE PHONE first and the tax service's
 * own record is asked for what was bought — exact, no model, so FREE — and only a slip that has no
 * readable code (hand-written, faded, a torn footer) falls through to the PRO photo read. One
 * picker, because the master photographs a receipt without knowing whether it carries a code.</p>
 *
 * <p>Everything read lands in ONE editable review, grouped by receipt, and is appended by a single
 * «Додати». Prices are NOT added to the catalog. The photos are offered to the object's «Чеки»
 * folder afterwards — the paper is the proof, and the estimate lines alone do not keep it.</p>
 */
export function ReceiptImportSheet({
  open,
  onClose,
  estimateId,
  projectId,
}: {
  open: boolean;
  onClose: () => void;
  estimateId: string;
  projectId: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const invalidateEstimate = useInvalidateEstimate(estimateId);
  const { online } = useOnlineGuard(); // both routes are server-side — no offline path
  const [step, setStep] = useState<Step>('source');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [committing, setCommitting] = useState(false);
  const heldFiles = useRef<File[]>([]);
  const receiptTotal = useRef(0);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [savePhotoOpen, setSavePhotoOpen] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  // Reading a receipt PHOTO is the paid capability; everything the QR hands back is free.
  const { data: me } = useMe();
  const isPro = (me?.plan ?? 'FREE') !== 'FREE';

  // The object's receipt-photo budget is a SEPARATE per-object cap (5 on FREE) and a pile can
  // exhaust it mid-way. Loaded once the review is on screen, so the offer below can say how many
  // will actually land instead of letting the last uploads fail one by one.
  const { data: limits } = usePlanLimits();
  const { data: objectPhotos } = usePhotos(projectId, step === 'review');
  const receiptCap = limits?.maxReceiptPhotosPerObject ?? null;
  const receiptRoom =
    receiptCap == null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, receiptCap - (objectPhotos ?? []).filter((p) => p.source === 'RECEIPT').length);

  const reset = () => {
    setStep('source');
    setProgress({ done: 0, total: 0 });
    setDrafts([]);
    heldFiles.current = [];
    receiptTotal.current = 0;
    setCommitting(false);
    setExpenseOpen(false);
    setSavePhotoOpen(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  /** Both routes answer the same proposal shape, so both become the same editable rows. */
  const toDrafts = (
    items: { name: string; quantity: number | null; unitPrice: number | null;
             unit: Unit | null; type: ItemType }[],
    receipt: number,
    via: 'qr' | 'photo',
    firstKey: number,
  ): Draft[] =>
    items.map((it, i) => ({
      key: firstKey + i,
      receipt,
      via,
      name: it.name,
      quantity: it.quantity != null && it.quantity > 0 ? String(it.quantity) : '',
      price: it.unitPrice != null && it.unitPrice > 0 ? String(it.unitPrice) : '',
      unit: it.unit ?? '',
      type: it.type,
      include: true,
    }));

  /**
   * One receipt, cheapest rung first: the fiscal code off the photo itself (local decode → the tax
   * service's record, free), then the model. Returns null when neither could read the paper — a
   * normal outcome for a hand-written slip on a FREE plan, not an error worth a toast of its own.
   */
  const readOne = async (
    file: File,
  ): Promise<{ items: Draft[]; via: 'qr' | 'photo' } | null> => {
    try {
      // Budgeted: jsqr is synchronous, and ten full 6-second ladders would freeze the phone.
      const payload = await decodeQrFromFile(file, { budgetMs: BATCH_QR_BUDGET_MS });
      if (payload && looksFiscal(payload)) {
        const res = await receiptImportApi.parseQr(estimateId, payload);
        if (res.items.length > 0) return { items: toDrafts(res.items, 0, 'qr', 0), via: 'qr' };
      }
    } catch {
      // An unreadable code, or one the tax service had no positions for: this endpoint answers 400
      // by design, because on its own it is the whole feature. Here it is only the first rung.
    }
    if (!isPro) return null;
    const res = await receiptImportApi.parse(estimateId, file);
    return res.items.length > 0 ? { items: toDrafts(res.items, 0, 'photo', 0), via: 'photo' } : null;
  };

  const onPick = async (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    if (picked.length === 0) return;
    // Both routes run on the server (the tax service / Claude vision) — impossible offline.
    if (!online) {
      toast.error(t('offline.needConnection'));
      return;
    }
    const files = picked.filter((f) => /^image\/(png|jpeg|jpg|webp)$/.test(f.type) && f.size <= MAX_BYTES);
    if (files.length < picked.length) toast.error(t('receipt.someSkipped', { count: picked.length - files.length }));
    if (files.length === 0) return;

    heldFiles.current = files;
    setStep('parsing');
    setProgress({ done: 0, total: files.length });
    const all: Draft[] = [];
    let unread = 0;
    let error: string | null = null;
    for (const [i, file] of files.entries()) {
      try {
        // Full-resolution on purpose — a dense fiscal receipt has small monospace text, and both
        // the QR decode and the model lose it if the photo is shrunk first. Downscaling happens
        // only for the photo that is later KEPT.
        const read = await readOne(file);
        if (read) {
          for (const d of read.items) {
            all.push({ ...d, key: all.length, receipt: i + 1, via: read.via });
          }
        } else {
          unread += 1;
        }
      } catch (err) {
        unread += 1;
        error ??= toAppError(err).message; // one message per batch, never N identical toasts
      }
      setProgress({ done: i + 1, total: files.length });
    }
    setDrafts(all);
    setStep('review');
    if (error) toast.error(error);
    else if (unread > 0) toast.info(t('receipt.someUnread', { count: unread }));
    // The photo read is what PRO pays for, so a FREE master whose slips carried no code has just
    // watched the feature do nothing — name the reason instead of leaving an empty review.
    if (unread > 0 && !isPro) {
      void upgradeApi.click('RECEIPT_IMPORT');
      setUpgradeOpen(true);
    }
  };

  const patch = (key: number, next: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...next } : d)));

  // The ordinal restarts inside each slip: it numbers the positions ON that receipt, which is
  // the only numbering the master can check against the paper beside it.
  const ordinals = new Map<number, number>();
  const perReceipt = new Map<number, number>();
  for (const d of drafts) {
    const n = (perReceipt.get(d.receipt) ?? 0) + 1;
    perReceipt.set(d.receipt, n);
    ordinals.set(d.key, n);
  }

  const included = drafts.filter((d) => d.include);
  // A row needs a name + unit; quantity/price may be 0 (master fills later).
  const hasBad = included.some((d) => !d.name.trim() || !d.unit);

  const commit = async () => {
    setCommitting(true);
    try {
      await receiptImportApi.commit(
        estimateId,
        included.map((d) => ({
          name: d.name.trim(),
          unit: d.unit as Unit,
          quantity: num(d.quantity),
          unitPrice: num(d.price),
          type: d.type,
          category: null,
        })),
      );
      // The estimate total changed, so the object list, dashboard and economy are stale
      // too — use the shared set, not just this estimate.
      invalidateEstimate();
      toast.success(t('receipt.added', { count: included.length }));
      // The receipts are also the master's real cost — offer to log them as ONE object expense
      // (closes the cash-flow loop). Then offer to keep the photos.
      receiptTotal.current = included.reduce((s, d) => s + num(d.quantity) * num(d.price), 0);
      if (receiptTotal.current > 0) setExpenseOpen(true);
      else offerToKeepPhoto();
    } catch (err) {
      toast.error(toAppError(err).message);
      setCommitting(false);
    }
  };

  const saveExpense = async (save: boolean) => {
    setExpenseOpen(false);
    if (save && receiptTotal.current > 0) {
      try {
        await economyApi.addExpense(projectId, {
          amount: receiptTotal.current,
          category: 'MATERIALS',
          note: t('receipt.expenseNote'),
          spentAt: null,
          source: 'RECEIPT',
        });
        void qc.invalidateQueries({ queryKey: ['object-economy', projectId] });
        toast.success(t('receipt.expenseSaved'));
      } catch (err) {
        toast.error(toAppError(err).message); // fail-soft — the estimate lines already committed
      }
    }
    offerToKeepPhoto();
  };

  const offerToKeepPhoto = () => {
    if (heldFiles.current.length === 0) {
      close();
      return;
    }
    // No room left at all: offering «Зберегти» that would save nothing is a lie, so say why instead.
    if (receiptRoom === 0) {
      toast.info(t('receipt.photosCapReached', { max: receiptCap ?? 0 }));
      close();
      return;
    }
    setSavePhotoOpen(true);
  };

  const saveReceiptPhoto = async (save: boolean) => {
    setSavePhotoOpen(false);
    if (save && heldFiles.current.length > 0) {
      // Only what fits — the cap is checked BEFORE uploading, so the pile never turns into a run of
      // failures. A failure that still happens never stops the rest of the files.
      let saved = 0;
      let error: string | null = null;
      for (const file of heldFiles.current.slice(0, receiptRoom)) {
        try {
          // Shrink for storage only (the read used the full-res original).
          const compact = await downscaleImage(file);
          await photosApi.upload(projectId, compact, { source: 'RECEIPT', estimateId });
          saved += 1;
        } catch (err) {
          error ??= toAppError(err).message;
        }
      }
      void qc.invalidateQueries({ queryKey: ['project-photos', projectId] });
      if (saved > 0) toast.success(t('receipt.photosSaved', { count: saved }));
      if (error) toast.error(error);
    }
    close();
  };

  return (
    <>
      <Modal open={open} onClose={close} title={t('receipt.title')} size="lg">
        {step === 'source' && (
          <div className="space-y-3">
            <p className="text-sm text-muted">{t('receipt.sourceHint')}</p>
            <Button fullWidth onClick={() => cameraRef.current?.click()}>
              📷 {t('receipt.takePhoto')}
            </Button>
            <Button fullWidth variant="secondary" onClick={() => uploadRef.current?.click()}>
              🖼 {t('receipt.upload')}
            </Button>
            {/* The gate is on the paid RUNG, not on the picker: a slip with a fiscal code is read
                for free, so blocking the pick would hide a free capability behind a PRO wall. */}
            <p className="text-xs text-muted">
              {t('receipt.ladderHint')} {!isPro && <ProChip />}
            </p>
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                void onPick(e.target.files);
                e.target.value = '';
              }}
            />
            <input
              ref={uploadRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                void onPick(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        )}

        {step === 'parsing' && (
          <div className="py-10 text-center">
            <Spinner size="lg" />
            <p className="mt-3 text-sm text-muted">
              {progress.total > 1
                ? t('receipt.batchReading', { done: Math.min(progress.done + 1, progress.total), total: progress.total })
                : t('receipt.parsing')}
            </p>
          </div>
        )}

        {step === 'review' && (
          <div>
            {drafts.length === 0 ? (
              <EmptyReview onRetry={reset} />
            ) : (
              <>
                <p className="mb-3 text-sm text-muted">{t('receipt.reviewHint')}</p>
                <div className="max-h-[55dvh] space-y-2 overflow-y-auto">
                  {drafts.map((d, i) => {
                    const bad = d.include && (!d.name.trim() || !d.unit);
                    // One review, but the master must still see WHICH slip a row came from — and
                    // how it was read, since a QR row is the tax service's own record and a photo
                    // row is a guess worth checking.
                    const newReceipt = i === 0 || drafts[i - 1].receipt !== d.receipt;
                    const photo = heldFiles.current[d.receipt - 1];
                    return (
                      <div key={d.key} className={newReceipt && i > 0 ? 'mt-4' : undefined}>
                        {newReceipt && (
                          <div className="mb-1 flex items-center gap-2">
                            {photo && (
                              <ReceiptPhoto
                                variant="thumb"
                                source={{ kind: 'file', file: photo }}
                                title={t('receipt.receiptNo', { n: d.receipt })}
                              />
                            )}
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                              {t('receipt.receiptNo', { n: d.receipt })} ·{' '}
                              {t(d.via === 'qr' ? 'receipt.viaQr' : 'receipt.viaPhoto')}
                            </p>
                          </div>
                        )}
                        <div
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
                            <ReceiptOrdinal n={ordinals.get(d.key) ?? 1} className="pt-2.5" />
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
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <Input
                              value={d.quantity}
                              inputMode="decimal"
                              onChange={(e) => patch(d.key, { quantity: e.target.value })}
                              placeholder={t('estimateImport.qtyPlaceholder')}
                            />
                            <Select
                              value={d.unit}
                              onChange={(e) => patch(d.key, { unit: e.target.value as Unit | '' })}
                            >
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
                        </div>
                      </div>
                    );
                  })}
                </div>
                <Button
                  fullWidth
                  className="mt-4"
                  disabled={included.length === 0 || hasBad}
                  loading={committing}
                  onClick={() => void commit()}
                >
                  {t('receipt.addN', { count: included.length })}
                </Button>
              </>
            )}
          </div>
        )}
      </Modal>

      <UpgradeIntentModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />

      <ConfirmDialog
        open={expenseOpen}
        title={t('receipt.expenseTitle')}
        message={t('receipt.expenseMessage', { amount: formatMoney(receiptTotal.current) })}
        confirmLabel={t('receipt.expenseYes')}
        onConfirm={() => void saveExpense(true)}
        onClose={() => void saveExpense(false)}
      />

      <ConfirmDialog
        open={savePhotoOpen}
        title={t('receipt.savePhotoTitle', { count: heldFiles.current.length })}
        message={
          receiptRoom < heldFiles.current.length
            ? t('receipt.savePhotoPartial', {
                saved: receiptRoom, total: heldFiles.current.length, max: receiptCap ?? 0 })
            : t('receipt.savePhotoMessage')
        }
        confirmLabel={t('receipt.savePhotoYes')}
        onConfirm={() => void saveReceiptPhoto(true)}
        onClose={() => void saveReceiptPhoto(false)}
      />
    </>
  );
}

function ProChip() {
  const { t } = useTranslation();
  return (
    <span className="ml-1 rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
      {t('landing.proBadge')}
    </span>
  );
}

function EmptyReview({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="py-8 text-center">
      <p className="text-sm text-muted">{t('receipt.nothingFound')}</p>
      <Button className="mt-4" variant="secondary" onClick={onRetry}>
        {t('receipt.tryAgain')}
      </Button>
    </div>
  );
}
