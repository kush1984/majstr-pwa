import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Select } from '@/components/Select.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { QrScanSheet } from '@/components/QrScanSheet.tsx';
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
import { cn } from '@/lib/cn.ts';
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
  name: string;
  quantity: string;
  price: string;
  unit: Unit | '';
  type: ItemType;
  include: boolean;
}

type Step = 'source' | 'parsing' | 'review';

/**
 * Add items to the open estimate from a receipt — two ways into the same review.
 *
 * <p>«Зчитати QR» reads the fiscal code printed on the slip and asks the tax service for what was
 * bought: no model, no cost, so it is FREE. The photo route (camera / upload → Claude vision) is
 * the PRO one, and the only one that works on paper with no fiscal code — a hand-written slip, a
 * faded print. Both land in the same editable review before anything is appended.</p>
 *
 * <p>Prices are NOT added to the catalog. After commit the master is offered to keep the receipt
 * photo (private, attached to this object) — the same File is re-uploaded, so the parse step never
 * persists anything, and the QR route skips that offer outright: it never held a photo.</p>
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
  const { online } = useOnlineGuard(); // LLM recognition is server-side — no offline path
  const [step, setStep] = useState<Step>('source');
  // Which route is in flight: «Розпізнаємо чек…» is a lie while the tax service is being queried,
  // and the two waits feel different enough (seconds vs tens of them) to be worth naming.
  const [via, setVia] = useState<'photo' | 'qr'>('photo');
  const [qrOpen, setQrOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [committing, setCommitting] = useState(false);
  const heldFile = useRef<File | null>(null);
  const receiptTotal = useRef(0);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [savePhotoOpen, setSavePhotoOpen] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  // Reading a receipt PHOTO is the paid capability; everything the QR hands back is free.
  const { data: me } = useMe();
  const isPro = (me?.plan ?? 'FREE') !== 'FREE';

  const reset = () => {
    setStep('source');
    setVia('photo');
    setQrOpen(false);
    setDrafts([]);
    heldFile.current = null;
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
  const toDrafts = (items: { name: string; quantity: number | null; unitPrice: number | null;
                             unit: Unit | null; type: ItemType }[]): Draft[] =>
    items.map((it, i) => ({
      key: i,
      name: it.name,
      quantity: it.quantity != null && it.quantity > 0 ? String(it.quantity) : '',
      price: it.unitPrice != null && it.unitPrice > 0 ? String(it.unitPrice) : '',
      unit: it.unit ?? '',
      type: it.type,
      include: true,
    }));

  const onQrScanned = async (payload: string) => {
    setQrOpen(false);
    // The lookup runs server-side against the tax service — impossible offline, same as the model.
    if (!online) {
      toast.error(t('offline.needConnection'));
      return;
    }
    setVia('qr');
    setStep('parsing');
    try {
      const res = await receiptImportApi.parseQr(estimateId, payload);
      setDrafts(toDrafts(res.items));
      setStep('review');
    } catch (err) {
      // Unreadable code / no positions in it — a named message, and back to the source step so the
      // photo route is one tap away. The QR is the fast path, never the only one.
      toast.error(toAppError(err).message);
      reset();
    }
  };

  const pickPhoto = (ref: React.RefObject<HTMLInputElement | null>) => {
    if (!isPro) {
      void upgradeApi.click('RECEIPT_IMPORT');
      setUpgradeOpen(true);
      return;
    }
    ref.current?.click();
  };

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    // Recognition runs on the server (Claude vision) — impossible offline; say so up front.
    if (!online) {
      toast.error(t('offline.needConnection'));
      return;
    }
    if (!/^image\/(png|jpeg|jpg|webp)$/.test(file.type)) {
      toast.error(t('photos.badType'));
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(t('photos.tooLarge'));
      return;
    }
    // Parse the FULL-resolution image — a dense fiscal receipt has small monospace text,
    // so downscaling before OCR loses items. Downscaling happens only if the photo is
    // later kept (saveReceiptPhoto), not for extraction.
    heldFile.current = file;
    setVia('photo');
    setStep('parsing');
    try {
      const res = await receiptImportApi.parse(estimateId, file);
      setDrafts(toDrafts(res.items));
      setStep('review');
    } catch (err) {
      toast.error(toAppError(err).message);
      reset();
    }
  };

  const patch = (key: number, next: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...next } : d)));

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
      // The receipt is also the master's real cost — offer to log it as an object expense
      // (closes the cash-flow loop). Then offer to keep the receipt photo.
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

  /** The QR route never held a file, so there is nothing to keep — asking would be a dead dialog. */
  const offerToKeepPhoto = () => {
    if (heldFile.current) setSavePhotoOpen(true);
    else close();
  };

  const saveReceiptPhoto = async (save: boolean) => {
    setSavePhotoOpen(false);
    if (save && heldFile.current) {
      try {
        // Shrink for storage only (parse used the full-res original).
        const compact = await downscaleImage(heldFile.current);
        await photosApi.upload(projectId, compact, { source: 'RECEIPT', estimateId });
        void qc.invalidateQueries({ queryKey: ['project-photos', projectId] });
        toast.success(t('receipt.photoSaved'));
      } catch (err) {
        toast.error(toAppError(err).message);
      }
    }
    close();
  };

  return (
    <>
      <Modal open={open} onClose={close} title={t('receipt.title')} size="lg">
        {step === 'source' && (
          <div className="space-y-3">
            <p className="text-sm text-muted">{t('receipt.sourceHint')}</p>
            {/* The QR sits first and as the primary button: it is free, exact, and takes one aim
                at the paper — the photo routes below it are the fallback for a slip that has no
                fiscal code (hand-written, faded) and the reason they are PRO. */}
            <Button fullWidth onClick={() => setQrOpen(true)}>
              🔳 {t('receipt.qrOption')}
            </Button>
            <p className="-mt-1 text-xs text-muted">{t('receipt.qrHint')}</p>
            <Button fullWidth variant="secondary" onClick={() => pickPhoto(cameraRef)}>
              📷 {t('receipt.takePhoto')} {!isPro && <ProChip />}
            </Button>
            <Button fullWidth variant="secondary" onClick={() => pickPhoto(uploadRef)}>
              🖼 {t('receipt.upload')} {!isPro && <ProChip />}
            </Button>
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                void onPick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <input
              ref={uploadRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                void onPick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        )}

        {step === 'parsing' && (
          <div className="py-10 text-center">
            <Spinner size="lg" />
            <p className="mt-3 text-sm text-muted">{t(via === 'qr' ? 'receipt.qrReading' : 'receipt.parsing')}</p>
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
                  {drafts.map((d) => {
                    const bad = d.include && (!d.name.trim() || !d.unit);
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

      <QrScanSheet open={qrOpen} onClose={() => setQrOpen(false)} onScanned={(p) => void onQrScanned(p)} />

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
        title={t('receipt.savePhotoTitle')}
        message={t('receipt.savePhotoMessage')}
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
