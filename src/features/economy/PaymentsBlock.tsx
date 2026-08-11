import { useEffect, useMemo, useState } from 'react';
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
  useAddReceipt,
  useAddReceiptTransfer,
  useEditReceipt,
  useDeleteReceipt,
  useTransferSurplus,
} from './useEconomy.ts';
import type {
  PaymentsSummaryResponse,
  PaymentSplitPreset,
  PaymentSplitRow,
  PaymentReceiptResponse,
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

// ---- soft date validation (client-side only — never blocks save) -----------

function receivedDateWarning(iso: string, objectCreatedAt: string | undefined, t: (k: string) => string): string | null {
  if (!iso) return null;
  if (iso > today()) return t('economy.dateWarningFuture');
  if (objectCreatedAt) {
    const created = new Date(objectCreatedAt).toISOString().slice(0, 10);
    if (iso < created) return t('economy.dateWarningBeforeObject');
  }
  return null;
}

function dueDateWarning(iso: string, isCreate: boolean, t: (k: string) => string): string | null {
  if (!iso || !isCreate) return null;
  return iso < today() ? t('economy.dateWarningPastDue') : null;
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

// ---------------------------------------------------------------------------
// One shared vertical timeline — plan stages (with their own receipt history
// nested underneath) and unplanned receipts, merged and sorted by date.
// ---------------------------------------------------------------------------

type TimelineNode =
  | { kind: 'stage'; key: string; date: string | null; stage: ProjectPaymentResponse }
  | { kind: 'unplanned'; key: string; date: string | null; receipt: PaymentReceiptResponse };

function buildTimeline(summary: PaymentsSummaryResponse): TimelineNode[] {
  const stageNodes: TimelineNode[] = summary.payments.map((stage) => ({
    kind: 'stage',
    key: stage.id,
    date: stage.dueDate ?? stage.receipts?.[0]?.receivedAt ?? null,
    stage,
  }));
  const unplannedNodes: TimelineNode[] = (summary.unplannedReceipts ?? []).map((receipt) => ({
    kind: 'unplanned',
    key: receipt.id,
    date: receipt.receivedAt,
    receipt,
  }));
  return [...stageNodes, ...unplannedNodes].sort((a, b) => {
    if (a.date === b.date) return 0;
    if (a.date === null) return 1; // undated stages sink to the bottom
    if (b.date === null) return -1;
    return a.date < b.date ? -1 : 1;
  });
}

function ReceiptHistoryRow({ receipt, onEdit }: { receipt: PaymentReceiptResponse; onEdit: () => void }) {
  return (
    <button
      type="button"
      onClick={onEdit}
      className="flex w-full items-center justify-between py-1 pl-6 text-left text-xs text-muted"
    >
      <span>＋{formatMoney(receipt.amount)}</span>
      <span>{fmtDate(receipt.receivedAt)}</span>
    </button>
  );
}

function PaymentTimelineNode({
  node,
  onEditStage,
  onQuickPay,
  onEditReceipt,
}: {
  node: TimelineNode;
  onEditStage: (stage: ProjectPaymentResponse) => void;
  onQuickPay: (stage: ProjectPaymentResponse) => void;
  onEditReceipt: (receipt: PaymentReceiptResponse) => void;
}) {
  const { t } = useTranslation();
  if (node.kind === 'unplanned') {
    const r = node.receipt;
    return (
      <div className="border-b border-border py-2.5 last:border-b-0">
        <button type="button" onClick={() => onEditReceipt(r)} className="flex w-full items-start gap-3 text-left">
          <span className="mt-1.5 h-3 w-3 flex-shrink-0 rounded-full bg-success" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-primary">{r.displayLabel}</span>
            <span className="mt-0.5 block text-xs text-muted">{fmtDate(r.receivedAt)}</span>
          </span>
          <span className="flex-shrink-0 text-right text-sm font-semibold text-primary">{formatMoney(r.amount)}</span>
        </button>
      </div>
    );
  }

  const stage = node.stage;
  const condition = conditionText(stage);
  const notFullyReceived = stage.remaining > 0;
  return (
    <div className="border-b border-border py-2.5 last:border-b-0">
      <button type="button" onClick={() => onEditStage(stage)} className="flex w-full items-start gap-3 text-left">
        <span className={cn('mt-1.5 h-3 w-3 flex-shrink-0 rounded-full', STATUS_DOT[stage.status])} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-primary">{stage.purpose}</span>
          {condition && <span className="mt-0.5 block text-xs text-muted">{condition}</span>}
        </span>
        <span className="flex-shrink-0 text-right text-sm font-semibold text-primary">
          {stage.received > 0 ? `${formatMoney(stage.received)} / ${formatMoney(stage.amount)}` : formatMoney(stage.amount)}
        </span>
      </button>
      {notFullyReceived && (
        <button
          type="button"
          onClick={() => onQuickPay(stage)}
          className="ml-6 mt-1 text-xs font-semibold text-brand"
        >
          + {t('economy.receivePayment')}
        </button>
      )}
      {stage.receipts && stage.receipts.length > 0 && (
        <div className="mt-1">
          {stage.receipts.map((r) => (
            <ReceiptHistoryRow key={r.id} receipt={r} onEdit={() => onEditReceipt(r)} />
          ))}
        </div>
      )}
    </div>
  );
}

function PaymentTimeline({
  summary,
  onEditStage,
  onQuickPay,
  onEditReceipt,
}: {
  summary: PaymentsSummaryResponse;
  onEditStage: (stage: ProjectPaymentResponse) => void;
  onQuickPay: (stage: ProjectPaymentResponse) => void;
  onEditReceipt: (receipt: PaymentReceiptResponse) => void;
}) {
  const nodes = useMemo(() => buildTimeline(summary), [summary]);
  if (nodes.length === 0) return null;
  return (
    <div className="mt-3 border-t border-border pt-1">
      {nodes.map((n) => (
        <PaymentTimelineNode
          key={n.key}
          node={n}
          onEditStage={onEditStage}
          onQuickPay={onQuickPay}
          onEditReceipt={onEditReceipt}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PLAN — «Запланований». No fact fields at all: mark-received routes through
// ReceivePaymentSheet now, never a PATCH on this row.
// ---------------------------------------------------------------------------

function PaymentSheet({
  open,
  onClose,
  objectId,
  editing,
  summary,
  onReceivePayment,
}: {
  open: boolean;
  onClose: () => void;
  objectId: string;
  editing: ProjectPaymentResponse | null;
  summary: PaymentsSummaryResponse;
  /** Opens the "Отриманий платіж" flow preselected on `editing` — a no-op while creating. */
  onReceivePayment: () => void;
}) {
  const { t } = useTranslation();
  const add = useAddPayment(objectId);
  const update = useUpdatePayment(objectId);
  const del = useDeletePayment(objectId);
  const transferSurplus = useTransferSurplus(objectId);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  // "На «X» отримано більше — перенести сюди?", offered after creating a new stage while another
  // one is sitting over-received (RESERVE). `toId` is the just-created stage's id.
  const [surplusPrompt, setSurplusPrompt] = useState<{ fromId: string; fromPurpose: string; surplus: number; toId: string } | null>(null);

  const [purpose, setPurpose] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [nextStage, setNextStage] = useState('');

  useEffect(() => {
    if (!open) return;
    setPurpose(editing?.purpose ?? '');
    setAmount(editing ? String(editing.amount) : '');
    setDueDate(editing?.dueDate ?? '');
    setNextStage(editing?.nextStage ?? '');
    setSurplusPrompt(null);
  }, [open, editing]);

  const dueWarning = dueDateWarning(dueDate, !editing, t);

  const submit = async () => {
    const amountValue = Number(amount.replace(',', '.'));
    if (!purpose.trim() || !Number.isFinite(amountValue) || amountValue < 0) {
      toast.error(t('economy.paymentInvalid'));
      return;
    }
    const req: ProjectPaymentRequest = {
      purpose: purpose.trim(),
      amount: amountValue,
      dueDate: dueDate || null,
      nextStage: nextStage.trim() || null,
    };
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, req });
        onClose();
        return;
      }
      const created = await add.mutateAsync(req);
      const overReceived = summary.payments.find((p) => p.received > p.amount);
      if (overReceived) {
        setSurplusPrompt({
          fromId: overReceived.id, fromPurpose: overReceived.purpose,
          surplus: overReceived.received - overReceived.amount, toId: created.id,
        });
        return; // keep the sheet open behind the prompt until the master answers
      }
      onClose();
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  const confirmTransferSurplus = async () => {
    if (!surplusPrompt) return;
    try {
      await transferSurplus.mutateAsync({ fromPaymentId: surplusPrompt.fromId, toPaymentId: surplusPrompt.toId });
    } catch (err) {
      toast.error(toAppError(err).message);
    }
    setSurplusPrompt(null);
    onClose();
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
            <span className="mb-1 block text-xs font-semibold text-muted">{t('economy.amount')}</span>
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
            {dueWarning && <span className="mt-1 block text-xs text-amber">{dueWarning}</span>}
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted">{t('economy.nextStage')}</span>
            <Input value={nextStage} onChange={(e) => setNextStage(e.target.value)} placeholder={t('economy.nextStagePlaceholder')} />
          </label>

          {editing && (
            <div className="flex items-center justify-between rounded-xl bg-surface-sunken p-3">
              <span className="text-xs text-muted">
                {editing.received > 0
                  ? `${t('economy.received')}: ${formatMoney(editing.received)} / ${formatMoney(editing.amount)}`
                  : `${t('economy.received')}: —`}
              </span>
              {editing.remaining > 0 && (
                <button type="button" onClick={onReceivePayment} className="text-xs font-semibold text-brand">
                  {t('economy.receivePayment')}
                </button>
              )}
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

      {surplusPrompt && (
        <ConfirmDialog
          open
          title={t('economy.surplusHintTitle')}
          message={t('economy.surplusHintMessage', {
            purpose: surplusPrompt.fromPurpose, amount: formatMoney(surplusPrompt.surplus),
          })}
          confirmLabel={t('economy.surplusHintConfirm')}
          loading={transferSurplus.isPending}
          onConfirm={confirmTransferSurplus}
          onClose={() => { setSurplusPrompt(null); onClose(); }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// FACT — «Отриманий платіж». The ONE path money enters through: pick a plan
// stage (or "Своє"), amount defaults to the stage's remaining balance, an
// overpayment asks the master how to resolve it before saving.
// ---------------------------------------------------------------------------

type OverflowChoice = 'TRANSFER' | 'INCREASE' | 'RESERVE';

function OverflowConfirmSheet({
  open,
  onClose,
  diff,
  nextPurpose,
  receivedTotal,
  onChoose,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  diff: number;
  nextPurpose: string | null;
  receivedTotal: number;
  onChoose: (choice: OverflowChoice) => void;
  loading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Modal open={open} onClose={onClose} title={t('economy.overflowTitle')}>
      <div className="space-y-3">
        <p className="text-sm text-muted">{t('economy.overflowMessage', { amount: formatMoney(diff) })}</p>
        {nextPurpose && (
          <Button fullWidth variant="secondary" loading={loading} onClick={() => onChoose('TRANSFER')}>
            {t('economy.overflowTransfer', { purpose: nextPurpose })}
          </Button>
        )}
        <Button fullWidth variant="secondary" loading={loading} onClick={() => onChoose('INCREASE')}>
          {t('economy.overflowIncrease', { amount: formatMoney(receivedTotal) })}
        </Button>
        {!nextPurpose && (
          <Button fullWidth variant="secondary" loading={loading} onClick={() => onChoose('RESERVE')}>
            {t('economy.overflowReserve')}
          </Button>
        )}
      </div>
    </Modal>
  );
}

function ReceivePaymentSheet({
  open,
  onClose,
  objectId,
  summary,
  preselectedStageId,
  objectCreatedAt,
}: {
  open: boolean;
  onClose: () => void;
  objectId: string;
  summary: PaymentsSummaryResponse;
  preselectedStageId: string | null;
  objectCreatedAt: string | undefined;
}) {
  const { t } = useTranslation();
  const addReceipt = useAddReceipt(objectId);
  const addTransfer = useAddReceiptTransfer(objectId);
  const openStages = summary.payments.filter((p) => p.remaining > 0);

  const [stageId, setStageId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [overflow, setOverflow] = useState<{ diff: number; nextPurpose: string | null } | null>(null);

  useEffect(() => {
    if (!open) return;
    const initial = preselectedStageId ?? openStages[0]?.id ?? null;
    setStageId(initial);
    setLabel('');
    const stage = initial ? openStages.find((s) => s.id === initial) : null;
    setAmount(stage ? String(stage.remaining) : '');
    setDate(today());
    setOverflow(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preselectedStageId]);

  const selectedStage = stageId ? summary.payments.find((p) => p.id === stageId) ?? null : null;
  const dateWarning = receivedDateWarning(date, objectCreatedAt, t);

  const nextOpenStageAfter = (stage: ProjectPaymentResponse): ProjectPaymentResponse | null => {
    const idx = summary.payments.findIndex((p) => p.id === stage.id);
    if (idx < 0) return null;
    return summary.payments.slice(idx + 1).find((p) => p.remaining > 0) ?? null;
  };

  const doSubmit = async (resolution?: OverflowChoice) => {
    const amountValue = Number(amount.replace(',', '.'));
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      toast.error(t('economy.receivedAmountInvalid'));
      return;
    }
    if (!stageId && !label.trim()) {
      toast.error(t('economy.labelRequired'));
      return;
    }
    if (!stageId) {
      const conflict = summary.payments.some(
        (p) => p.purpose.trim().toLowerCase() === label.trim().toLowerCase(),
      );
      if (conflict) {
        toast.error(t('economy.labelConflict'));
        return;
      }
    }
    const req = {
      planPaymentId: stageId,
      label: stageId ? null : label.trim(),
      amount: amountValue,
      receivedAt: date,
      resolution: resolution ?? null,
    };
    try {
      if (resolution === 'TRANSFER') {
        await addTransfer.mutateAsync(req);
      } else {
        await addReceipt.mutateAsync(req);
      }
      setOverflow(null);
      onClose();
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  const submit = async () => {
    const amountValue = Number(amount.replace(',', '.'));
    if (selectedStage && Number.isFinite(amountValue)) {
      const diff = amountValue - selectedStage.remaining;
      if (diff > 0.004) {
        const next = nextOpenStageAfter(selectedStage);
        setOverflow({ diff, nextPurpose: next?.purpose ?? null });
        return;
      }
    }
    await doSubmit();
  };

  const loading = addReceipt.isPending || addTransfer.isPending;

  return (
    <>
      <Modal open={open} onClose={onClose} title={t('economy.receivePaymentTitle')}>
        <div className="space-y-4">
          <div>
            <span className="mb-1 block text-xs font-semibold text-muted">{t('economy.purpose')}</span>
            <div className="flex flex-wrap gap-1.5">
              {openStages.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { setStageId(s.id); setAmount(String(s.remaining)); }}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-semibold',
                    stageId === s.id ? 'border-brand bg-brand-soft text-primary' : 'border-border text-muted',
                  )}
                >
                  {s.purpose} · {formatMoney(s.remaining)}
                </button>
              ))}
              <button
                type="button"
                onClick={() => { setStageId(null); setAmount(''); }}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs font-semibold',
                  stageId === null ? 'border-brand bg-brand-soft text-primary' : 'border-border text-muted',
                )}
              >
                {t('economy.customLabelOption')}
              </button>
            </div>
          </div>

          {stageId === null && (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted">{t('economy.customLabelName')}</span>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('economy.customLabelPlaceholder')} />
            </label>
          )}

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

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted">{t('economy.date')}</span>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            {dateWarning && <span className="mt-1 block text-xs text-amber">{dateWarning}</span>}
          </label>

          <Button fullWidth loading={loading} onClick={submit}>
            {t('common.save')}
          </Button>
        </div>
      </Modal>

      {overflow && (
        <OverflowConfirmSheet
          open
          onClose={() => setOverflow(null)}
          diff={overflow.diff}
          nextPurpose={overflow.nextPurpose}
          receivedTotal={(selectedStage?.received ?? 0) + Number(amount.replace(',', '.') || 0)}
          loading={loading}
          onChoose={(choice) => void doSubmit(choice)}
        />
      )}
    </>
  );
}

/** Edit/delete one already-recorded receipt — amount/date/label only. */
function EditReceiptSheet({
  open,
  onClose,
  objectId,
  receipt,
}: {
  open: boolean;
  onClose: () => void;
  objectId: string;
  receipt: PaymentReceiptResponse | null;
}) {
  const { t } = useTranslation();
  const edit = useEditReceipt(objectId);
  const del = useDeleteReceipt(objectId);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [label, setLabel] = useState('');
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  useEffect(() => {
    if (!open || !receipt) return;
    setAmount(String(receipt.amount));
    setDate(receipt.receivedAt);
    setLabel(receipt.label ?? '');
  }, [open, receipt]);

  const submit = async () => {
    if (!receipt) return;
    const value = Number(amount.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      toast.error(t('economy.receivedAmountInvalid'));
      return;
    }
    try {
      await edit.mutateAsync({
        id: receipt.id,
        req: { amount: value, receivedAt: date, label: receipt.planPaymentId ? null : label.trim() },
      });
      onClose();
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  const confirmDelete = async () => {
    if (!receipt) return;
    try {
      await del.mutateAsync(receipt.id);
      setConfirmDeleteOpen(false);
      onClose();
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title={t('economy.editReceiptTitle')}>
        <div className="space-y-4">
          {receipt && !receipt.planPaymentId && (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted">{t('economy.customLabelName')}</span>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} />
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted">{t('economy.amount')}</span>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-lg font-bold" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted">{t('economy.date')}</span>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <Button fullWidth loading={edit.isPending} onClick={submit}>
            {t('common.save')}
          </Button>
          <Button variant="secondary" fullWidth onClick={() => setConfirmDeleteOpen(true)}>
            {t('common.delete')}
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title={t('economy.deleteReceiptTitle')}
        message={t('economy.deleteReceiptMessage')}
        confirmLabel={t('common.delete')}
        loading={del.isPending}
        onConfirm={confirmDelete}
        onClose={() => setConfirmDeleteOpen(false)}
      />
    </>
  );
}

/** "+ Платіж" fans out into two flows — a planned amount and a payment already in hand are
 *  different enough moments that picking wrong is worse than one extra tap. */
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
 * contracted/received/remaining summary and one shared vertical timeline (plan stages + their
 * receipt history + unplanned receipts), no cost/profit anywhere here.
 */
export function PaymentsBlock({
  objectId,
  summary,
  objectCreatedAt,
}: {
  objectId: string;
  summary: PaymentsSummaryResponse;
  /** For the soft "not before the object existed" check on a received date — optional, the
   *  check is simply skipped when the caller doesn't have it handy. */
  objectCreatedAt?: string;
}) {
  const { t } = useTranslation();
  const [addChoiceOpen, setAddChoiceOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectPaymentResponse | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receivePreselect, setReceivePreselect] = useState<string | null>(null);
  const [editingReceipt, setEditingReceipt] = useState<PaymentReceiptResponse | null>(null);

  const openEdit = (row: ProjectPaymentResponse | null) => {
    setEditing(row);
    setSheetOpen(true);
  };

  const openReceive = (preselect: string | null) => {
    setReceivePreselect(preselect);
    setReceiveOpen(true);
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

      <PaymentTimeline
        summary={summary}
        onEditStage={openEdit}
        onQuickPay={(stage) => openReceive(stage.id)}
        onEditReceipt={setEditingReceipt}
      />

      <AddPaymentChoiceModal
        open={addChoiceOpen}
        onClose={() => setAddChoiceOpen(false)}
        onPlanned={() => { setAddChoiceOpen(false); openEdit(null); }}
        onReceived={() => { setAddChoiceOpen(false); openReceive(null); }}
      />
      <PaymentSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        objectId={objectId}
        editing={editing}
        summary={summary}
        onReceivePayment={() => { if (editing) { setSheetOpen(false); openReceive(editing.id); } }}
      />
      <ReceivePaymentSheet
        open={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        objectId={objectId}
        summary={summary}
        preselectedStageId={receivePreselect}
        objectCreatedAt={objectCreatedAt}
      />
      <EditReceiptSheet
        open={editingReceipt !== null}
        onClose={() => setEditingReceipt(null)}
        objectId={objectId}
        receipt={editingReceipt}
      />
      <SplitSheet open={splitOpen} onClose={() => setSplitOpen(false)} objectId={objectId} />
    </section>
  );
}
