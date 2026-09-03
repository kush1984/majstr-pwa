import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Select } from '@/components/Select.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { dictationApi } from '@/api/dictation.ts';
import { toast } from '@/hooks/useToast.ts';
import { useOnlineGuard } from '@/hooks/useOnlineGuard.ts';
import { toAppError } from '@/api/errors.ts';
import { parseDecimal } from '@/lib/decimal.ts';
import { cn } from '@/lib/cn.ts';
import { useInvalidateEstimate } from './useEstimate.ts';
import { UNITS } from '@/api/types.ts';
import type { DictationItem, ItemType, Unit } from '@/api/types.ts';

/** Parse a decimal field to a finite number, blank/garbage → 0 (master may fill later). */
function num(s: string): number {
  const n = parseDecimal(s);
  return Number.isFinite(n) ? n : 0;
}

interface Draft {
  key: number;
  /** The catalog's wording when matched, else what he said — editable either way. */
  name: string;
  /** What he actually said. Shown only when it differs from `name`, so a wrong match is visible. */
  spokenName: string;
  quantity: string;
  price: string;
  unit: Unit | '';
  type: ItemType;
  /** Did his own price list have this position? A miss means the price is his to type. */
  matched: boolean;
  include: boolean;
}

type Step = 'input' | 'parsing' | 'review';

function toDrafts(items: DictationItem[]): Draft[] {
  return items.map((it, i) => ({
    key: i,
    name: it.name,
    spokenName: it.spokenName,
    quantity: it.quantity != null && it.quantity > 0 ? String(it.quantity) : '',
    price: it.unitPrice != null && it.unitPrice > 0 ? String(it.unitPrice) : '',
    unit: it.unit ?? '',
    type: it.type,
    matched: it.catalogItemId != null,
    include: true,
  }));
}

/**
 * Dictate (or type) positions into an open estimate — cut 0.
 *
 * <p><b>There is no audio here, deliberately.</b> The field is plain text and the microphone is the
 * one already on the master's PHONE keyboard: the OS transcribes far better than we would, in
 * Ukrainian, on the device. (Windows voice typing has no Ukrainian — on a desktop the text is
 * typed, which changes nothing here: this screen starts once the text is in the field.) What we add is the part it cannot do — splitting «поклеїти
 * шпалери двадцять квадратів по 250» into a position, a number and a unit, and pinning it to HIS
 * price list.</p>
 *
 * <p><b>A miss is shown, never priced at 0 ₴ behind his back.</b> A row the catalog had no answer
 * for is flagged in the review with its price field empty — that is the whole reason this screen
 * exists instead of appending the lines straight away.</p>
 */
export function DictationSheet({
  open,
  onClose,
  estimateId,
}: {
  open: boolean;
  onClose: () => void;
  estimateId: string;
}) {
  const { t } = useTranslation();
  const invalidateEstimate = useInvalidateEstimate(estimateId);
  const { online } = useOnlineGuard(); // the parse is a model call — no offline path
  const [step, setStep] = useState<Step>('input');
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [committing, setCommitting] = useState(false);

  const reset = () => {
    setStep('input');
    setText('');
    setDrafts([]);
    setCommitting(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const patch = (key: number, p: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...p } : d)));

  const included = drafts.filter((d) => d.include);
  const hasBad = included.some((d) => !d.name.trim() || !d.unit);
  const unpriced = included.filter((d) => num(d.price) <= 0).length;

  const runParse = async () => {
    if (!online) {
      toast.error(t('offline.needConnection'));
      return;
    }
    setStep('parsing');
    try {
      const res = await dictationApi.parse(estimateId, text.trim());
      setDrafts(toDrafts(res.items));
      setStep('review');
    } catch (err) {
      toast.error(toAppError(err).message);
      setStep('input'); // his text is still in the field — a failed read must not cost him it
    }
  };

  const commit = async () => {
    setCommitting(true);
    try {
      await dictationApi.commit(
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
      invalidateEstimate();
      toast.success(t('dictation.added', { count: included.length }));
      close();
    } catch (err) {
      toast.error(toAppError(err).message);
      setCommitting(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title={t('dictation.title')} size="lg">
      {step === 'input' && (
        <div className="space-y-3">
          <p className="text-sm text-muted">{t('dictation.hint')}</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            aria-label={t('dictation.fieldLabel')}
            placeholder={t('dictation.placeholder')}
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-base text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
          <p className="text-xs text-muted">{t('dictation.catalogHint')}</p>
          <Button fullWidth disabled={!text.trim() || !online} onClick={() => void runParse()}>
            {t('dictation.recognize')}
          </Button>
        </div>
      )}

      {step === 'parsing' && (
        <div className="py-10 text-center">
          <Spinner size="lg" />
          <p className="mt-3 text-sm text-muted">{t('dictation.parsing')}</p>
        </div>
      )}

      {step === 'review' && (
        <div>
          {drafts.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted">{t('dictation.nothingFound')}</p>
              <Button className="mt-4" variant="secondary" onClick={() => setStep('input')}>
                {t('dictation.backToText')}
              </Button>
            </div>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted">{t('dictation.reviewHint')}</p>
              {unpriced > 0 && (
                // Named before he taps «Додати», not after: an unpriced line is legal (he may fill
                // it in the editor) but it must never be something he finds out about later.
                <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {t('dictation.unpricedWarning', { count: unpriced })}
                </p>
              )}
              <div className="max-h-[55dvh] space-y-2 overflow-y-auto">
                {drafts.map((d) => {
                  const bad = d.include && (!d.name.trim() || !d.unit);
                  const noPrice = d.include && num(d.price) <= 0;
                  return (
                    <div
                      key={d.key}
                      className={cn(
                        'rounded-xl border p-3',
                        !d.include
                          ? 'border-border bg-surface-sunken opacity-50'
                          : bad || noPrice
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
                      {/* Two different facts, both worth a line: whether his price list answered,
                          and — when it answered with a different wording — what he actually said. */}
                      {!d.matched && (
                        <p className="mt-1 text-xs text-amber-700">{t('dictation.notInCatalog')}</p>
                      )}
                      {d.matched && d.spokenName.trim().toLowerCase() !== d.name.trim().toLowerCase() && (
                        <p className="mt-1 text-xs text-muted">
                          {t('dictation.spokenAs', { text: d.spokenName })}
                        </p>
                      )}
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
                {t('dictation.addN', { count: included.length })}
              </Button>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
