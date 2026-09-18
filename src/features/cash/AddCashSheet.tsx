import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Modal } from '@/components/Modal.tsx';
import { FormField } from '@/components/FormField.tsx';
import { parseDecimal } from '@/lib/decimal.ts';
import {
  CASH_EXPENSE_CATEGORIES, CASH_INCOME_CATEGORIES,
  type CashCategory, type CashDirection, type CashEntryRequest, type CashEntryResponse,
} from '@/api/types.ts';


const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Add one line of the master's own money — or correct ANY line of the feed, an object's included.
 *
 * <p><b>Adding asks nothing about an object.</b> An earlier round offered a picker that routed the
 * entry into a chosen object's journal; it read as a required step in front of a screen that
 * already pulls every object by itself, so it is gone. What he types here is what no object knows
 * about.</p>
 *
 * <p><b>Editing covers every kind</b> (master's ruling: «з можливістю видаляти рядки чи едітати»),
 * and the sheet shows only what that row's table actually has: an object payment has no category
 * and no direction to change — it is income by being a payment — and a PLANNED one is named by its
 * stage, so its text is read-only rather than a field that silently discards what he types.</p>
 *
 * <p>«Повернення за матеріал» shows on income of either kind: it keeps the money in the movement and
 * takes it out of «Заробив», because material the client paid back is not earnings.</p>
 *
 * <p>There is deliberately no TIME field. It is stamped server-side, and its only job is ordering
 * rows inside a day — a time picker on every entry is friction for nothing else.</p>
 */
export function AddCashSheet({
  open, entry, onClose, onSubmit, onDelete,
}: {
  open: boolean;
  /** Present = editing that row, whichever table it lives in. */
  entry?: CashEntryResponse | null;
  onClose: () => void;
  onSubmit: (req: CashEntryRequest) => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const kind = entry?.kind ?? 'PERSONAL';
  const isPayment = kind === 'OBJECT_PAYMENT';

  const [direction, setDirection] = useState<CashDirection>('INCOME');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<CashCategory | ''>('');
  const [note, setNote] = useState('');
  const [day, setDay] = useState(today());
  const [refund, setRefund] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed whenever the sheet opens: a stale draft from the last entry is worse than an empty one,
  // and the edit sheet is the same component opened on a row.
  useEffect(() => {
    if (!open) return;
    // INCOME by default (master's call): what he opens this sheet to write down is most often money
    // he just got. An expense is one tap away.
    setDirection(entry?.direction ?? 'INCOME');
    setAmount(entry ? String(entry.amount) : '');
    setCategory(entry?.category ?? '');
    setNote(entry?.note ?? '');
    setDay(entry?.happenedOn ?? today());
    setRefund(entry?.materialRefund ?? false);
    setError(null);
  }, [open, entry]);

  const categories = direction === 'INCOME' ? CASH_INCOME_CATEGORIES : CASH_EXPENSE_CATEGORIES;

  const submit = () => {
    // Handles the comma AND the space a phone keyboard puts in «1 200».
    const value = parseDecimal(amount);
    if (value == null || value <= 0) {
      setError(t('cash.amountRequired'));
      return;
    }
    onSubmit({
      direction,
      amount: value,
      category: category === '' ? null : category,
      note: note.trim() || null,
      happenedOn: day,
      materialRefund: direction === 'INCOME' && refund,
      // Which table the server should write through. A create is always his own row.
      kind: entry ? entry.kind : null,
    });
  };

  return (
    <Modal open={open} onClose={onClose} title={t(entry ? 'cash.editTitle' : 'cash.addTitle')}>
      <div className="space-y-3">
        {/* Which object this money belongs to — stated, never asked. It is already in that
            object's journal; this row is a view of it, and the edit below writes back there. */}
        {entry?.projectName && (
          <p className="rounded-xl border border-border bg-surface-sunken px-3 py-2 text-xs text-muted">
            {t('cash.fromObject', { name: entry.projectName })}
          </p>
        )}

        {/* The first decision, and the biggest control on the sheet — but only where there IS a
            decision: an object's payment is income by being a payment, and its expense an expense.
            Moving a row between those two would mean moving it between tables. */}
        {kind === 'PERSONAL' && (
          <div className="flex gap-2">
            {(['INCOME', 'EXPENSE'] as CashDirection[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => { setDirection(d); setCategory(''); }}
                aria-pressed={direction === d}
                className={
                  'min-h-11 flex-1 rounded-xl px-3 text-sm font-bold ' +
                  (direction === d
                    ? (d === 'INCOME' ? 'bg-success text-white' : 'bg-brand text-white')
                    : 'bg-surface-sunken text-secondary')
                }
              >
                {t(d === 'INCOME' ? 'cash.directionIncome' : 'cash.directionExpense')}
              </button>
            ))}
          </div>
        )}

        <FormField label={t('cash.amount')} error={error ?? undefined}>
          <Input
            type="text"
            inputMode="decimal"
            autoFocus
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setError(null); }}
            placeholder="0"
          />
        </FormField>

        <FormField label={t('cash.date')}>
          <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </FormField>

        {/* Optional on purpose: a master at the wheel will not pick one, and the note carries it.
            Hidden for an object PAYMENT, which has no category at all — offering one would invent
            a field the object's table does not have. */}
        {!isPayment && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-secondary">{t('cash.category')}</p>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(category === c ? '' : c)}
                aria-pressed={category === c}
                className={
                  'min-h-11 rounded-full px-3.5 text-sm font-semibold ' +
                  (category === c ? 'bg-brand-soft text-brand' : 'bg-surface-sunken text-secondary')
                }
              >
                {t('cashCategory.' + c)}
              </button>
            ))}
          </div>
        </div>
        )}

        {/* A PLANNED receipt is named by its payment stage, and `editReceipt` deliberately leaves
            that alone — so the field is read-only rather than one that discards what he types. */}
        <FormField
          label={t('cash.note')}
          hint={entry?.noteLocked ? t('cash.noteFromStage') : undefined}
        >
          <Input
            type="text"
            value={note}
            disabled={entry?.noteLocked ?? false}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('cash.notePlaceholder')}
          />
        </FormField>

        {direction === 'INCOME' && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5">
            <input
              type="checkbox"
              checked={refund}
              onChange={(e) => setRefund(e.target.checked)}
              className="h-5 w-5 rounded border-gray-300 text-brand-600 focus:ring-brand-300"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-primary">{t('cash.refund')}</span>
              <span className="block text-xs text-muted">{t('cash.refundHint')}</span>
            </span>
          </label>
        )}

        <div className="flex gap-2 pt-1">
          {onDelete && (
            <Button variant="ghost" onClick={onDelete}>{t('common.delete')}</Button>
          )}
          <Button variant="secondary" fullWidth onClick={onClose}>{t('common.cancel')}</Button>
          <Button fullWidth onClick={submit}>{t('common.save')}</Button>
        </div>
      </div>
    </Modal>
  );
}
