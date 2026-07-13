import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Select } from '@/components/Select.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { receiptImportApi } from '@/api/receiptImport.ts';
import { photosApi } from '@/api/photos.ts';
import { economyApi } from '@/api/economy.ts';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { parseDecimal } from '@/lib/decimal.ts';
import { formatMoney } from '@/lib/format.ts';
import { downscaleImage } from '@/lib/image.ts';
import { cn } from '@/lib/cn.ts';
import { ESTIMATE_KEY } from './useEstimate.ts';
import type { ItemType, Unit } from '@/api/types.ts';

const UNITS: Unit[] = ['M2', 'M', 'LINEAR_METER', 'PIECE', 'KG', 'HOUR', 'SET', 'M3', 'T', 'POINT', 'PERCENT', 'KM'];
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
 * Add items to the open estimate from a receipt photo (PRO). Camera / upload →
 * Claude vision → editable review → append to the estimate. Prices are NOT added
 * to the catalog. After commit the master is offered to keep the receipt photo
 * (private, attached to this object) — the same File is re-uploaded, so the parse
 * step never persists anything.
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
  const [step, setStep] = useState<Step>('source');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [committing, setCommitting] = useState(false);
  const heldFile = useRef<File | null>(null);
  const receiptTotal = useRef(0);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [savePhotoOpen, setSavePhotoOpen] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep('source');
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

  const onPick = async (file: File | undefined) => {
    if (!file) return;
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
    setStep('parsing');
    try {
      const res = await receiptImportApi.parse(estimateId, file);
      setDrafts(
        res.items.map((it, i) => ({
          key: i,
          name: it.name,
          quantity: it.quantity != null && it.quantity > 0 ? String(it.quantity) : '',
          price: it.unitPrice != null && it.unitPrice > 0 ? String(it.unitPrice) : '',
          unit: it.unit ?? '',
          type: it.type,
          include: true,
        })),
      );
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
      qc.invalidateQueries({ queryKey: [...ESTIMATE_KEY, estimateId] });
      toast.success(t('receipt.added', { count: included.length }));
      // The receipt is also the master's real cost — offer to log it as an object expense
      // (closes the cash-flow loop). Then offer to keep the receipt photo.
      receiptTotal.current = included.reduce((s, d) => s + num(d.quantity) * num(d.price), 0);
      if (receiptTotal.current > 0) setExpenseOpen(true);
      else setSavePhotoOpen(true);
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
        qc.invalidateQueries({ queryKey: ['object-economy', projectId] });
        toast.success(t('receipt.expenseSaved'));
      } catch (err) {
        toast.error(toAppError(err).message); // fail-soft — the estimate lines already committed
      }
    }
    setSavePhotoOpen(true);
  };

  const saveReceiptPhoto = async (save: boolean) => {
    setSavePhotoOpen(false);
    if (save && heldFile.current) {
      try {
        // Shrink for storage only (parse used the full-res original).
        const compact = await downscaleImage(heldFile.current);
        await photosApi.upload(projectId, compact, { source: 'RECEIPT', estimateId });
        qc.invalidateQueries({ queryKey: ['project-photos', projectId] });
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
            <Button fullWidth onClick={() => cameraRef.current?.click()}>
              📷 {t('receipt.takePhoto')}
            </Button>
            <Button fullWidth variant="secondary" onClick={() => uploadRef.current?.click()}>
              🖼 {t('receipt.upload')}
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
            <p className="mt-3 text-sm text-muted">{t('receipt.parsing')}</p>
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
