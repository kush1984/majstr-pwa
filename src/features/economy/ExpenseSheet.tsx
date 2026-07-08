import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Input } from '@/components/Input.tsx';
import { Button } from '@/components/Button.tsx';
import { cn } from '@/lib/cn.ts';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { useAddExpense, useUpdateExpense } from './useEconomy.ts';
import type { ExpenseCategory, ExpenseResponse } from '@/api/types.ts';

const CATEGORIES: { value: ExpenseCategory; icon: string }[] = [
  { value: 'MATERIALS', icon: '🧱' },
  { value: 'LABOR', icon: '🔨' },
  { value: 'OTHER', icon: '•' },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Fast expense entry — the goal is ≤15 seconds standing in a hardware store. Amount
 * is the only required field (numeric keyboard, autofocused); category is three chips
 * (default Materials); note optional; date defaults to today. Doubles as the editor.
 */
export function ExpenseSheet({
  open,
  onClose,
  objectId,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  objectId: string;
  editing: ExpenseResponse | null;
}) {
  const { t } = useTranslation();
  const add = useAddExpense(objectId);
  const update = useUpdateExpense(objectId);

  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('MATERIALS');
  const [note, setNote] = useState('');
  const [spentAt, setSpentAt] = useState(today());

  // Prime the form when opened (edit → existing values, create → defaults).
  useEffect(() => {
    if (!open) return;
    setAmount(editing ? String(editing.amount) : '');
    setCategory(editing?.category ?? 'MATERIALS');
    setNote(editing?.note ?? '');
    setSpentAt(editing?.spentAt ?? today());
  }, [open, editing]);

  const submit = async () => {
    const value = Number(amount.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      toast.error(t('economy.amountRequired'));
      return;
    }
    const req = { amount: value, category, note: note.trim() || null, spentAt };
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, req });
      } else {
        await add.mutateAsync(req);
      }
      onClose();
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? t('economy.editExpense') : t('economy.addExpense')}>
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted">{t('economy.amount')}</span>
          <Input
            autoFocus
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0 ₴"
            className="text-lg font-bold"
          />
        </label>

        <div className="flex gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setCategory(c.value)}
              className={cn(
                'flex-1 rounded-xl border py-2.5 text-sm font-semibold',
                category === c.value ? 'border-brand bg-brand-soft text-primary' : 'border-border text-muted',
              )}
            >
              {c.icon} {t('economy.cat.' + c.value)}
            </button>
          ))}
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted">{t('economy.noteOptional')}</span>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('economy.notePlaceholder')} />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted">{t('economy.date')}</span>
          <Input type="date" value={spentAt} onChange={(e) => setSpentAt(e.target.value)} />
        </label>

        <Button fullWidth loading={add.isPending || update.isPending} onClick={submit}>
          {t('common.save')}
        </Button>
      </div>
    </Modal>
  );
}
