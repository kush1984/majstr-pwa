import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toAppError } from '@/api/errors.ts';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Modal } from '@/components/Modal.tsx';
import { FormField } from '@/components/FormField.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { parseMoney } from '@/lib/decimal.ts';
import {
  CASH_EXPENSE_CATEGORIES, CASH_INCOME_CATEGORIES, CASH_OBJECT_EXPENSE_CATEGORIES,
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
 * <p>«Повернення за матеріал» shows on income of either kind. Since review B-33 it LABELS the row
 * and nothing more — the material it repays is itself a feed row, so «Заробив» nets out on its
 * own — but the label is what explains the gap between «Прийшло» and «Заробив».</p>
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
  /** Rejecting keeps the sheet open with the server's own words under the field (review P-20). */
  onSubmit: (req: CashEntryRequest) => void | Promise<unknown>;
  onDelete?: () => void | Promise<unknown>;
}) {
  const { t } = useTranslation();
  const kind = entry?.kind ?? 'PERSONAL';
  // Same rule as the direction toggle: offer only what that row's table actually has. Neither a
  // plan payment nor a till receipt has a category — a `project_receipt` is a photographed slip
  // with a label and a sum — so a chip row there would invent a field and discard the answer.
  const hasCategory = kind === 'PERSONAL' || kind === 'OBJECT_EXPENSE';

  const [direction, setDirection] = useState<CashDirection>('INCOME');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<CashCategory | ''>('');
  const [note, setNote] = useState('');
  const [day, setDay] = useState(today());
  const [refund, setRefund] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

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
    setBusy(false);
    setConfirming(false);
  }, [open, entry]);

  // An object's expense has only the three buckets `object_expenses` actually stores: FUEL, TOOLS
  // and TAXES all fold into OTHER on the way in (`CashCategory.toExpenseCategory`), so offering
  // them here was a chip that answered a question and then threw the answer away.
  const categories = direction === 'EXPENSE'
    ? (kind === 'OBJECT_EXPENSE' ? CASH_OBJECT_EXPENSE_CATEGORIES : CASH_EXPENSE_CATEGORIES)
    : CASH_INCOME_CATEGORIES;

  /**
   * Nothing leaves this sheet that the server would not recognise as a number.
   *
   * <p>`parseDecimal` answered `NaN` for «12а», «1.200,50» and a Unicode minus, and `NaN` fails
   * neither `== null` nor `<= 0` — so online the server refused it after the sheet had closed and
   * the text was gone, and OFFLINE a `NaN` went into IndexedDB, rendered «NaN ₴», poisoned the
   * totals and blocked the queue hours later. `parseMoney` answers `null` instead (review P-20),
   * with the same bounds the server validates (B-37: ≥ 0,01, two decimals).</p>
   *
   * <p>And the sheet now WAITS for the write: a refusal belongs under the field he has to fix, not
   * in a toast over a screen he has already left.</p>
   */
  const submit = async () => {
    const value = parseMoney(amount);
    if (value == null) {
      setError(t('cash.amountInvalid'));
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        direction,
        amount: value,
        category: category === '' ? null : category,
        note: note.trim() || null,
        // A cleared date field is `''`, which the server reads as a blank string rather than «leave
        // it alone» — null is the word for that, and on a create it means today.
        happenedOn: day || null,
        materialRefund: direction === 'INCOME' && refund,
        // Which table the server should write through. A create is always his own row.
        kind: entry ? entry.kind : null,
      });
    } catch (e) {
      setBusy(false);
      setError(toAppError(e).message);
      return;
    }
    setBusy(false);
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

        {/* «Хто за це платить» is answered on the object's receipts screen, in front of the photo,
            and this sheet deliberately does not send it — a month's feed must not flip a receipt
            between «клієнт відшкодовує» and «моя витрата» in passing. */}
        {kind === 'OBJECT_RECEIPT' && (
          <p className="rounded-xl border border-border bg-surface-sunken px-3 py-2 text-xs text-muted">
            {t('cash.tillReceiptHint')}
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
        {hasCategory && (
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
          {/* Asked first, like every other delete in the app: this row may be an object's own
              payment or expense, and the write goes through that object's service — there is no
              undo behind it. `PaymentsBlock` set the pattern. */}
          {onDelete && (
            <Button variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>
              {t('common.delete')}
            </Button>
          )}
          <Button variant="secondary" fullWidth disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button fullWidth loading={busy} onClick={() => void submit()}>{t('common.save')}</Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        title={t('cash.deleteTitle')}
        message={t('cash.deleteMessage')}
        // Distinct from the sheet's own «Видалити», which stays on screen under the dialog.
        confirmLabel={t('cash.deleteConfirm')}
        onConfirm={() => {
          setConfirming(false);
          void onDelete?.();
        }}
        onClose={() => setConfirming(false)}
      />
    </Modal>
  );
}
