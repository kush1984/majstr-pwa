import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { InfoPopover } from '@/components/InfoPopover.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { formatMoney } from '@/lib/format.ts';
import { cn } from '@/lib/cn.ts';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import {
  useAddPayment,
  useUpdatePayment,
  useDeletePayment,
  usePreviewSplit,
  useCommitSplit,
} from './useEconomy.ts';
import type {
  PaymentsSummaryResponse,
  PaymentSplitPreset,
  PaymentSplitRow,
  ProjectPaymentRequest,
  ProjectPaymentResponse,
  ProjectPaymentStatus,
} from '@/api/types.ts';

const STATUS_DOT: Record<ProjectPaymentStatus, string> = {
  PLANNED: 'border-2 border-border bg-surface',
  PARTIAL: 'bg-brand',
  RECEIVED: 'bg-success',
  OVERDUE: 'bg-danger',
};

const PRESETS: { value: PaymentSplitPreset; label: string }[] = [
  { value: 'FIFTY_FIFTY', label: '50/50' },
  { value: 'THIRTY_FORTY_THIRTY', label: '30/40/30' },
  { value: 'THIRTY_THIRTY_FORTY', label: '30/30/40' },
  { value: 'CUSTOM', label: 'своя' },
];

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso + 'T00:00:00').toLocaleDateString('uk-UA', { day: '2-digit', month: 'long' });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Not a debt reminder — the condition for starting the NEXT stage of work. Never "ви винні". */
function conditionText(row: { dueDate: string | null; nextStage: string | null }): string | null {
  const date = fmtDate(row.dueDate);
  if (date && row.nextStage) return `Оплатити до ${date}, щоб почати «${row.nextStage}»`;
  if (date) return `Оплатити до ${date}`;
  if (row.nextStage) return `Щоб почати «${row.nextStage}»`;
  return null;
}

/** Horizontal progress bar — filled = received, empty = remaining. Mobile-first: one bar, a
 *  caption spelling out the split, no legend, no charting library. */
function PaymentStrip({ received, total }: { received: number; total: number }) {
  const { t } = useTranslation();
  const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
  return (
    <div className="mt-3">
      <div className="h-2.5 overflow-hidden rounded-full bg-surface-sunken">
        <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-muted">
        {formatMoney(received)} {t('economy.paymentsOf')} {formatMoney(total)} · {pct}%
      </p>
    </div>
  );
}

/** One row of the vertical payment timeline — a status dot + connector (via the border on the
 *  wrapping list), list-like on a phone, timeline-like at a glance. */
function PaymentListRow({
  row,
  onEdit,
}: {
  row: ProjectPaymentResponse;
  onEdit: () => void;
}) {
  const condition = conditionText(row);
  return (
    <button
      type="button"
      onClick={onEdit}
      className="flex w-full items-start gap-3 border-b border-border py-2.5 text-left last:border-b-0"
    >
      <span className={cn('mt-1.5 h-3 w-3 flex-shrink-0 rounded-full', STATUS_DOT[row.status])} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-primary">{row.purpose}</span>
        {condition && <span className="mt-0.5 block text-xs text-muted">{condition}</span>}
      </span>
      <span className="flex-shrink-0 text-right text-sm font-semibold text-primary">
        {row.paidAmount != null && row.paidAmount > 0
          ? `${formatMoney(row.paidAmount)} / ${formatMoney(row.amount)}`
          : formatMoney(row.amount)}
      </span>
    </button>
  );
}

function fmtPaidAt(iso: string): string {
  return new Date(iso).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Add/edit the PLANNED side of a payment row — purpose, amount, due-date condition, next stage.
 *  No "Отримано" field here (economy-rework iteration: plan and fact are two separate flows, so
 *  filling in a planned amount never also asks "and how much came in?" in the same breath). When
 *  editing an existing row, a status line + action hands off to {@link MarkReceivedSheet} for the
 *  fact side instead of duplicating it inline. */
function PaymentSheet({
  open,
  onClose,
  objectId,
  editing,
  onMarkReceived,
}: {
  open: boolean;
  onClose: () => void;
  objectId: string;
  editing: ProjectPaymentResponse | null;
  /** Opens the mark-received flow for `editing` — a no-op while creating (button hidden then). */
  onMarkReceived: () => void;
}) {
  const { t } = useTranslation();
  const add = useAddPayment(objectId);
  const update = useUpdatePayment(objectId);
  const del = useDeletePayment(objectId);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const [purpose, setPurpose] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [nextStage, setNextStage] = useState('');

  // Prime the form when opened (edit → existing values, create → defaults) — mirrors ExpenseSheet.
  useEffect(() => {
    if (!open) return;
    setPurpose(editing?.purpose ?? '');
    setAmount(editing ? String(editing.amount) : '');
    setDueDate(editing?.dueDate ?? '');
    setNextStage(editing?.nextStage ?? '');
  }, [open, editing]);

  const submit = async () => {
    const amountValue = Number(amount.replace(',', '.'));
    if (!purpose.trim() || !Number.isFinite(amountValue) || amountValue < 0) {
      toast.error(t('economy.paymentInvalid'));
      return;
    }
    // The fact side (paidAmount/paidAt) is untouched by this form — carry the existing values
    // through on an edit (update() is a full replace), stay null on a fresh planned row.
    const req: ProjectPaymentRequest = {
      purpose: purpose.trim(),
      amount: amountValue,
      dueDate: dueDate || null,
      nextStage: nextStage.trim() || null,
      paidAmount: editing?.paidAmount ?? null,
      paidAt: editing?.paidAt ?? null,
    };
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

  const confirmDelete = async () => {
    if (!editing) return;
    try {
      await del.mutateAsync(editing.id);
      setConfirmDeleteOpen(false);
      onClose();
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={editing ? t('economy.editPayment') : t('economy.addPayment')}
      >
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted">{t('economy.purpose')}</span>
            <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder={t('economy.purposePlaceholder')} />
          </label>

          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-xs font-semibold text-muted">
              {t('economy.amount')}
              <InfoPopover text={t('economy.amountVsReceivedInfo')} label={t('economy.amount')} />
            </span>
            <Input
              autoFocus={!editing}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0 ₴"
              className="text-lg font-bold"
            />
          </label>

          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-xs font-semibold text-muted">
              {t('economy.dueDate')}
              <InfoPopover text={t('economy.dueDateConditionInfo')} label={t('economy.dueDate')} />
            </span>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted">{t('economy.nextStage')}</span>
            <Input value={nextStage} onChange={(e) => setNextStage(e.target.value)} placeholder={t('economy.nextStagePlaceholder')} />
          </label>

          {editing && (
            <div className="flex items-center justify-between rounded-xl bg-surface-sunken p-3">
              <span className="text-xs text-muted">
                {editing.paidAmount != null
                  ? t('economy.receivedSummary', {
                      amount: formatMoney(editing.paidAmount),
                      date: editing.paidAt ? fmtPaidAt(editing.paidAt) : '',
                    })
                  : t('economy.paidAmount') + ': —'}
              </span>
              <button type="button" onClick={onMarkReceived} className="text-xs font-semibold text-brand">
                {editing.paidAmount != null ? t('economy.changeReceived') : t('economy.markReceived')}
              </button>
            </div>
          )}

          <Button fullWidth loading={add.isPending || update.isPending} onClick={submit}>
            {t('common.save')}
          </Button>
          {editing && (
            <Button variant="secondary" fullWidth onClick={() => setConfirmDeleteOpen(true)}>
              {t('common.delete')}
            </Button>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title={t('economy.deletePaymentTitle')}
        message={t('economy.deletePaymentMessage')}
        confirmLabel={t('common.delete')}
        loading={del.isPending}
        onConfirm={confirmDelete}
        onClose={() => setConfirmDeleteOpen(false)}
      />
    </>
  );
}

/** The FACT side, split out on its own — date (default today) + amount (default the planned
 *  amount, editable down to a partial payment). Reachable from an existing row's "Позначити
 *  отриманим" / "Змінити", never duplicated into the planned-fields form above. */
function MarkReceivedSheet({
  open,
  onClose,
  objectId,
  payment,
}: {
  open: boolean;
  onClose: () => void;
  objectId: string;
  payment: ProjectPaymentResponse | null;
}) {
  const { t } = useTranslation();
  const update = useUpdatePayment(objectId);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');

  useEffect(() => {
    if (!open || !payment) return;
    setAmount(String(payment.paidAmount ?? payment.amount));
    setDate(payment.paidAt ? payment.paidAt.slice(0, 10) : today());
  }, [open, payment]);

  const submit = async () => {
    if (!payment) return;
    const value = Number(amount.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      toast.error(t('economy.receivedAmountInvalid'));
      return;
    }
    const req: ProjectPaymentRequest = {
      purpose: payment.purpose,
      amount: payment.amount,
      dueDate: payment.dueDate,
      nextStage: payment.nextStage,
      paidAmount: value,
      paidAt: new Date(`${date}T00:00:00`).toISOString(),
    };
    try {
      await update.mutateAsync({ id: payment.id, req });
      onClose();
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('economy.markReceived')}>
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted">{t('economy.date')}</span>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
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
        <Button fullWidth loading={update.isPending} onClick={submit}>
          {t('common.save')}
        </Button>
      </div>
    </Modal>
  );
}

/** "+ Отриманий платіж" — a deposit or payment already in hand: purpose + amount + date in one
 *  step, planned and received set equal (no due-date/next-stage — it's already resolved). */
function QuickReceivedSheet({
  open,
  onClose,
  objectId,
}: {
  open: boolean;
  onClose: () => void;
  objectId: string;
}) {
  const { t } = useTranslation();
  const add = useAddPayment(objectId);
  const [purpose, setPurpose] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');

  useEffect(() => {
    if (!open) return;
    setPurpose('');
    setAmount('');
    setDate(today());
  }, [open]);

  const submit = async () => {
    const value = Number(amount.replace(',', '.'));
    if (!purpose.trim() || !Number.isFinite(value) || value <= 0) {
      toast.error(t('economy.paymentInvalid'));
      return;
    }
    const req: ProjectPaymentRequest = {
      purpose: purpose.trim(),
      amount: value,
      dueDate: null,
      nextStage: null,
      paidAmount: value,
      paidAt: new Date(`${date}T00:00:00`).toISOString(),
    };
    try {
      await add.mutateAsync(req);
      onClose();
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('economy.quickReceivedTitle')}>
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted">{t('economy.purpose')}</span>
          <Input autoFocus value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder={t('economy.purposePlaceholder')} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted">{t('economy.amount')}</span>
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0 ₴"
            className="text-lg font-bold"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted">{t('economy.date')}</span>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <Button fullWidth loading={add.isPending} onClick={submit}>
          {t('common.save')}
        </Button>
      </div>
    </Modal>
  );
}

/** "+ Платіж" fans out into two flows rather than one form trying to be both — a planned amount
 *  and a payment already in hand are different enough moments that picking wrong (and having to
 *  backtrack through fields) is worse than one extra tap. Mirrors the estimate-creation choice
 *  modal in ProjectDetailPage. */
function AddPaymentChoiceModal({
  open,
  onClose,
  onPlanned,
  onReceived,
}: {
  open: boolean;
  onClose: () => void;
  onPlanned: () => void;
  onReceived: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal open={open} onClose={onClose} title={t('economy.addPaymentChoiceTitle')}>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onPlanned}
          className="rounded-xl border border-border bg-surface p-3 text-left"
        >
          <span className="block text-sm font-semibold text-primary">{t('economy.addPaymentPlanned')}</span>
          <span className="mt-0.5 block text-[11px] text-muted">{t('economy.addPaymentPlannedHint')}</span>
        </button>
        <button
          type="button"
          onClick={onReceived}
          className="rounded-xl border border-border bg-surface p-3 text-left"
        >
          <span className="block text-sm font-semibold text-primary">{t('economy.addPaymentReceived')}</span>
          <span className="mt-0.5 block text-[11px] text-muted">{t('economy.addPaymentReceivedHint')}</span>
        </button>
      </div>
    </Modal>
  );
}

/** "Розбити на частки" — presets or a custom comma-separated percent list, previewed before
 *  saving (server computes against the live contracted total; the last row absorbs rounding). */
function SplitSheet({ open, onClose, objectId }: { open: boolean; onClose: () => void; objectId: string }) {
  const { t } = useTranslation();
  const [preset, setPreset] = useState<PaymentSplitPreset>('FIFTY_FIFTY');
  const [customText, setCustomText] = useState('');
  const [rows, setRows] = useState<PaymentSplitRow[] | null>(null);
  const [contractedTotal, setContractedTotal] = useState(0);
  const preview = usePreviewSplit(objectId);
  const commit = useCommitSplit(objectId);

  const customPercents = customText
    .split(',')
    .map((s) => Number(s.trim().replace(',', '.')))
    .filter((n) => Number.isFinite(n) && n > 0);

  const onPreview = async () => {
    setRows(null);
    try {
      const res = await preview.mutateAsync({
        preset,
        customPercents: preset === 'CUSTOM' ? customPercents : undefined,
      });
      setRows(res.rows);
      setContractedTotal(res.contractedTotal);
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  const onConfirm = async () => {
    try {
      await commit.mutateAsync({ preset, customPercents: preset === 'CUSTOM' ? customPercents : undefined });
      toast.success(t('economy.splitSaved'));
      setRows(null);
      setCustomText('');
      onClose();
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => { setRows(null); onClose(); }}
      title={t('economy.splitTitle')}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => { setPreset(p.value); setRows(null); }}
              className={cn(
                'rounded-xl border py-2.5 text-sm font-semibold',
                preset === p.value ? 'border-brand bg-brand-soft text-primary' : 'border-border text-muted',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {preset === 'CUSTOM' && (
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted">{t('economy.customPercentsLabel')}</span>
            <Input
              value={customText}
              onChange={(e) => { setCustomText(e.target.value); setRows(null); }}
              placeholder={t('economy.customPercentsPlaceholder')}
            />
          </label>
        )}

        <Button variant="secondary" fullWidth loading={preview.isPending} onClick={onPreview}>
          {t('economy.previewSplit')}
        </Button>

        {rows && (
          <div className="rounded-xl border border-border bg-surface-sunken p-3">
            <p className="mb-2 text-xs text-muted">
              {t('economy.contracted')}: {formatMoney(contractedTotal)}
            </p>
            <div className="space-y-1.5">
              {rows.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-primary">{r.purpose}</span>
                  <span className="font-semibold text-primary">{formatMoney(r.amount)}</span>
                </div>
              ))}
            </div>
            <Button fullWidth className="mt-3" loading={commit.isPending} onClick={onConfirm}>
              {t('economy.confirmSplit')}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * Object-level payments (завдаток + графік виплат) — FREE + PRO. "Гроші", never "прибуток": the
 * contracted/received/remaining summary and the schedule itself, no cost/profit anywhere here.
 */
export function PaymentsBlock({ objectId, summary }: { objectId: string; summary: PaymentsSummaryResponse }) {
  const { t } = useTranslation();
  const [addChoiceOpen, setAddChoiceOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [quickReceivedOpen, setQuickReceivedOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectPaymentResponse | null>(null);
  // The mark-received target: either an existing row (opened from its own sheet or list row) or
  // the row just picked from AddPaymentChoiceModal's "already received" quick-create — that one
  // goes through QuickReceivedSheet instead, so this is only ever an EXISTING row here.
  const [receivedFor, setReceivedFor] = useState<ProjectPaymentResponse | null>(null);

  const openEdit = (row: ProjectPaymentResponse | null) => {
    setEditing(row);
    setSheetOpen(true);
  };

  return (
    <section className="rounded-card border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-muted">{t('economy.paymentsTitle')}</h3>
        <div className="flex gap-3">
          <button type="button" onClick={() => setSplitOpen(true)} className="text-[13px] font-semibold text-brand">
            {t('economy.splitAction')}
          </button>
          <button
            type="button"
            onClick={() => setAddChoiceOpen(true)}
            className="text-[13px] font-semibold text-brand"
          >
            + {t('economy.addPaymentShort')}
          </button>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-sm font-bold text-primary">{formatMoney(summary.contractedTotal)}</div>
          <div className="mt-0.5 flex items-center justify-center gap-1 text-[11px] text-muted">
            {t('economy.contracted')}
            <InfoPopover text={t('economy.contractedInfo')} label={t('economy.contracted')} />
          </div>
        </div>
        <div>
          <div className="text-sm font-bold text-primary">{formatMoney(summary.received)}</div>
          <div className="mt-0.5 flex items-center justify-center gap-1 text-[11px] text-muted">
            {t('economy.received')}
            <InfoPopover text={t('economy.receivedInfo')} label={t('economy.received')} />
          </div>
        </div>
        <div>
          <div className="text-sm font-bold text-primary">{formatMoney(summary.remaining)}</div>
          <div className="mt-0.5 flex items-center justify-center gap-1 text-[11px] text-muted">
            {t('economy.remaining')}
            <InfoPopover text={t('economy.remainingInfo')} label={t('economy.remaining')} />
          </div>
        </div>
      </div>

      <PaymentStrip received={summary.received} total={summary.contractedTotal} />

      {summary.payments.length > 0 && (
        <div className="mt-3 border-t border-border pt-1">
          {summary.payments.map((row) => (
            <PaymentListRow key={row.id} row={row} onEdit={() => openEdit(row)} />
          ))}
        </div>
      )}

      <AddPaymentChoiceModal
        open={addChoiceOpen}
        onClose={() => setAddChoiceOpen(false)}
        onPlanned={() => { setAddChoiceOpen(false); openEdit(null); }}
        onReceived={() => { setAddChoiceOpen(false); setQuickReceivedOpen(true); }}
      />
      <PaymentSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        objectId={objectId}
        editing={editing}
        onMarkReceived={() => { if (editing) { setSheetOpen(false); setReceivedFor(editing); } }}
      />
      <MarkReceivedSheet
        open={receivedFor !== null}
        onClose={() => setReceivedFor(null)}
        objectId={objectId}
        payment={receivedFor}
      />
      <QuickReceivedSheet open={quickReceivedOpen} onClose={() => setQuickReceivedOpen(false)} objectId={objectId} />
      <SplitSheet open={splitOpen} onClose={() => setSplitOpen(false)} objectId={objectId} />
    </section>
  );
}
