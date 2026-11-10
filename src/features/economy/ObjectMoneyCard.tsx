import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/Button.tsx';
import { CollapseGroupRow } from '@/components/CollapseGroupRow.tsx';
import { Fab } from '@/components/Fab.tsx';
import { FormField } from '@/components/FormField.tsx';
import { Input } from '@/components/Input.tsx';
import { Modal } from '@/components/Modal.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { ErrorState } from '@/components/ErrorState.tsx';
import { toAppError } from '@/api/errors.ts';
import { routes } from '@/lib/config.ts';
import { formatMoney } from '@/lib/format.ts';
import { PAYMENT_MAX, parseMoney } from '@/lib/decimal.ts';
import { AddCashSheet } from '@/features/cash/AddCashSheet.tsx';
import { CashRow } from '@/features/cash/CashRow.tsx';
import type { CashEntryResponse, ExpenseCategory, ObjectMoneyResponse } from '@/api/types.ts';
import {
  useAddObjectExpense, useAddObjectIncome, useObjectMoney, useObjectMoneyRowActions,
} from './useObjectMoney.ts';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * «Гроші обʼєкта» — what came in for the work, what the master spent, what he earned, and the
 * client's material money on its own line.
 *
 * <p>It replaces the payments card (plan stages, «Розбити на частки», «Запланований»), which on prod
 * held eight stages over 150 objects, every one of them an advance. What masters actually do is
 * record money that moved, so that is the one thing here: «+» → «Отримав» / «Витратив» / «📷 Чек».</p>
 *
 * <p>Not a second formula: the figures are «Мої гроші» narrowed to this object, read from the same
 * server code, so the card and the filtered screen can never disagree. No crew warning: most
 * masters have no crew, and a line that never goes away for them is noise (owner's call).</p>
 */
export function ObjectMoneyCard({ objectId, canWrite, onLocked }: {
  objectId: string;
  /** Writes ride `Feature.OBJECT_ECONOMY`. Without it «+» opens the upgrade offer instead. */
  canWrite: boolean;
  onLocked: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const money = useObjectMoney(objectId);
  const rows = useObjectMoneyRowActions(objectId);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CashEntryResponse | null>(null);
  const [openGroup, setOpenGroup] = useState<{ in: boolean; out: boolean }>({ in: false, out: false });

  const openReceipts = () =>
    // Back to «Економіка», not the object's default «Кошториси» tab — the tab lives in the URL.
    navigate(routes.receipts(objectId), { state: { from: `${routes.project(objectId)}?tab=economy` } });

  if (money.isPending) {
    return <div className="py-6 text-center"><Spinner /></div>;
  }
  if (money.isError && !money.data) {
    return <ErrorState error={money.error} what={t('money.title')} onRetry={() => void money.refetch()} />;
  }
  const m = money.data;
  const entries = m.entries;
  const incoming = entries.filter((e) => e.direction === 'INCOME');
  const outgoing = entries.filter((e) => e.direction !== 'INCOME');

  return (
    <section className="rounded-card border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-muted">{t('money.title')}</h3>
        <button
          type="button"
          onClick={() => (canWrite ? setAdding(true) : onLocked())}
          className="min-h-11 px-1 text-[13px] font-semibold text-brand"
        >
          + {t('money.add')}
        </button>
      </div>

      <Figures money={m} />

      <MaterialLine money={m} onOpen={openReceipts} />

      {entries.length === 0 ? (
        <p className="mt-3 text-center text-sm text-muted">{t('money.empty')}</p>
      ) : (
        // Folded by default, like the old «✓ Отримано · N»: the figures above already say how much,
        // and an object with a year of crew pay would otherwise push everything below off screen.
        <div className="mt-2">
          {([
            ['in', incoming, t('money.groupIn', { count: incoming.length }), 'success'],
            ['out', outgoing, t('money.groupOut', { count: outgoing.length }), 'neutral'],
          ] as const).map(([key, rowsOf, label, tone]) => rowsOf.length > 0 && (
            <div key={key}>
              <CollapseGroupRow
                label={label}
                tone={tone}
                expanded={openGroup[key]}
                onToggle={() => setOpenGroup((g) => ({ ...g, [key]: !g[key] }))}
              />
              {openGroup[key] && (
                <div className="my-2 overflow-hidden rounded-xl border border-border">
                  {rowsOf.map((e) => (
                    <CashRow key={e.id} entry={e} hideProject onOpen={() => setEditing(e)} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Fab ariaLabel={t('money.add')} onClick={() => (canWrite ? setAdding(true) : onLocked())} />

      <AddMoneySheet
        open={adding}
        objectId={objectId}
        firstIncome={m.income === 0 && m.materials.given === 0}
        onClose={() => setAdding(false)}
        onReceipt={() => { setAdding(false); void openReceipts(); }}
      />
      <AddCashSheet
        open={editing != null}
        entry={editing}
        onClose={() => setEditing(null)}
        onSubmit={async (req) => {
          if (editing) await rows.update.mutateAsync({ id: editing.id, req });
          setEditing(null);
        }}
        onDelete={async () => {
          if (editing) await rows.remove.mutateAsync({ id: editing.id, kind: editing.kind });
          setEditing(null);
        }}
      />
    </section>
  );
}

/** Отримано за роботу / Витрачено / Заробив. */
function Figures({ money }: { money: ObjectMoneyResponse }) {
  const { t } = useTranslation();
  return (
    <div className="mt-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted">{t('money.income')}</span>
        <span className="font-mono text-sm font-semibold tabular-nums text-success">+{formatMoney(money.income)}</span>
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted">{t('money.expense')}</span>
        <span className="font-mono text-sm font-semibold tabular-nums text-primary">−{formatMoney(money.expense)}</span>
      </div>
      <div className="mt-2.5 flex items-baseline justify-between gap-2 border-t border-border pt-2.5">
        <span className="text-sm font-bold text-primary">{t('money.earned')}</span>
        <span className="font-mono text-base font-extrabold tabular-nums text-primary">{formatMoney(money.earned)}</span>
      </div>
    </div>
  );
}

/**
 * The client's material money: what he gave, what was bought for him, and where that leaves him.
 * Absent until either side exists — a permanent «0 · 0» row is noise. Opens the receipts, where
 * «хто платить» is decided in front of the paper.
 */
function MaterialLine({ money, onOpen }: { money: ObjectMoneyResponse; onOpen: () => void }) {
  const { t } = useTranslation();
  const { bought, given, outstanding, toActs } = money.materials;
  if (bought === 0 && given === 0) return null;
  const verdict = outstanding > 0
    ? t('money.materialOwes', { amount: formatMoney(outstanding) })
    : outstanding < 0
      ? t('money.materialLeft', { amount: formatMoney(-outstanding) })
      : t('money.materialSettled');
  // Its own block under a divider, captioned as apart from «Заробив»: right under the total, the
  // tinted box read as part of the master's earnings (master feedback).
  return (
    <div className="mt-3 border-t border-dashed border-border pt-3">
      <p className="mb-1.5 flex items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold text-muted">🧾 {t('money.materialTitle')}</span>
        <span className="text-faint">{t('money.materialApart')}</span>
      </p>
      <button
        type="button"
        onClick={onOpen}
        className={
          'block w-full rounded-xl border px-3 py-2 text-left '
          + (outstanding > 0 ? 'border-warning/40 bg-warning/10' : 'border-border bg-surface-sunken')
        }
      >
        <span className="block text-xs text-muted">
          {t('money.materialGiven', { amount: formatMoney(given) })}
          {' · '}{t('money.materialBought', { amount: formatMoney(bought) })}
          {(toActs ?? 0) > 0 && <>{' · '}{t('money.materialToActs', { amount: formatMoney(toActs ?? 0) })}</>}
        </span>
        <span className="mt-0.5 block text-sm font-semibold text-primary">{verdict}</span>
      </button>
    </div>
  );
}

type Purpose = 'ADVANCE' | 'WORK' | 'MATERIAL';
const PURPOSES: Purpose[] = ['ADVANCE', 'WORK', 'MATERIAL'];
const EXPENSE_KINDS: ExpenseCategory[] = ['LABOR', 'MATERIALS', 'OTHER'];

/**
 * «+» on the object: three answers, one tap each. A receipt goes to the object's receipts — the
 * camera, the QR and «клієнт поверне / моя витрата» all live there already, in front of the paper.
 */
function AddMoneySheet({ open, objectId, firstIncome, onClose, onReceipt }: {
  open: boolean;
  objectId: string;
  /** Nothing has come in yet — the first money is usually the advance. */
  firstIncome: boolean;
  onClose: () => void;
  onReceipt: () => void;
}) {
  const { t } = useTranslation();
  const addIncome = useAddObjectIncome(objectId);
  const addExpense = useAddObjectExpense(objectId);
  const [step, setStep] = useState<'choose' | 'in' | 'out'>('choose');
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState(today());
  const [note, setNote] = useState('');
  const [purpose, setPurpose] = useState<Purpose>('WORK');
  const [category, setCategory] = useState<ExpenseCategory>('LABOR');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep('choose');
    setAmount('');
    setDay(today());
    setNote('');
    setPurpose(firstIncome ? 'ADVANCE' : 'WORK');
    setCategory('LABOR');
    setError(null);
    setBusy(false);
  }, [open, firstIncome]);

  const submit = async () => {
    const value = parseMoney(amount, { max: PAYMENT_MAX });
    if (value == null) {
      setError(t('cash.amountInvalid'));
      return;
    }
    setBusy(true);
    try {
      if (step === 'in') {
        await addIncome.mutateAsync({
          // The purpose chip IS the name unless he wrote one — the server needs a label, and he
          // should not have to type «Завдаток».
          label: note.trim() || t('money.purpose' + purpose),
          amount: value,
          receivedAt: day || today(),
          materialRefund: purpose === 'MATERIAL',
        });
      } else {
        await addExpense.mutateAsync({
          amount: value, category, note: note.trim() || null, spentAt: day || null,
        });
      }
      onClose();
    } catch (e) {
      setError(toAppError(e).message);
      setBusy(false);
    }
  };

  const title = step === 'in' ? t('money.inTitle') : step === 'out' ? t('money.outTitle') : t('money.add');

  return (
    <Modal open={open} onClose={onClose} title={title}>
      {step === 'choose' ? (
        <div className="space-y-2">
          <ChoiceButton icon="↓" label={t('money.chooseIn')} hint={t('money.chooseInHint')} onClick={() => setStep('in')} />
          <ChoiceButton icon="↑" label={t('money.chooseOut')} hint={t('money.chooseOutHint')} onClick={() => setStep('out')} />
          <ChoiceButton icon="🧾" label={t('money.chooseReceipt')} hint={t('money.chooseReceiptHint')} onClick={onReceipt} />
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-sm font-medium text-secondary">
              {step === 'in' ? t('money.purposeLabel') : t('money.categoryLabel')}
            </p>
            <div className="flex flex-wrap gap-2">
              {step === 'in'
                ? PURPOSES.map((p) => (
                    <Chip key={p} on={purpose === p} onClick={() => setPurpose(p)}>
                      {t('money.purpose' + p)}
                    </Chip>
                  ))
                : EXPENSE_KINDS.map((c) => (
                    <Chip key={c} on={category === c} onClick={() => setCategory(c)}>
                      {t('money.category' + c)}
                    </Chip>
                  ))}
            </div>
            {step === 'in' && purpose === 'MATERIAL' && (
              <p className="mt-1.5 text-xs text-muted">{t('money.purposeMaterialHint')}</p>
            )}
          </div>

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

          <FormField label={t('cash.note')}>
            <Input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t(step === 'in' ? 'money.notePlaceholderIn' : 'money.notePlaceholderOut')}
            />
          </FormField>

          <div className="flex gap-2 pt-1">
            <Button variant="secondary" fullWidth disabled={busy} onClick={() => setStep('choose')}>
              {t('common.back')}
            </Button>
            <Button fullWidth loading={busy} onClick={() => void submit()}>{t('common.save')}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ChoiceButton({ icon, label, hint, onClick }: {
  icon: string; label: string; hint: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 text-left"
    >
      <span aria-hidden className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-surface-sunken text-lg">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-primary">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </button>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={
        'min-h-11 rounded-full px-3.5 text-sm font-semibold '
        + (on ? 'bg-brand-soft text-brand' : 'bg-surface-sunken text-secondary')
      }
    >
      {children}
    </button>
  );
}
