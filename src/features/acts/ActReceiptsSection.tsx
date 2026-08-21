import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Modal } from '@/components/Modal.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { InfoPopover } from '@/components/InfoPopover.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { actsApi } from '@/api/acts.ts';
import { formatMoney } from '@/lib/format.ts';
import { usePhotoBlobUrl } from '@/features/photos/PhotoView.tsx';
import { useAddActReceipt, useDeleteActReceipt, useUpdateActReceipt } from './useActs.ts';
import type { WorkActReceiptResponse } from '@/api/types.ts';

/**
 * «Чеки та рахунки» on one act — the materials the master paid for out of pocket and re-bills to
 * the client (master request, act-receipts iteration). Deliberately NOT a parsed line list: the
 * master photographs the paper, types what it cost, and the act carries «чек — сума» rows plus a
 * subtotal. The photo is the proof; the amount is what counts.
 *
 * <p>Receipts save the instant they're added, unlike the rest of the editor — a picked photo must
 * not be lost by leaving the screen, and a file upload can't ride the header's «Зберегти».</p>
 */
export function ActReceiptsSection({
  actId,
  projectId,
  receipts,
  signed,
  toExpenses,
  onToExpensesChange,
}: {
  actId: string;
  projectId: string;
  receipts: WorkActReceiptResponse[];
  signed: boolean;
  toExpenses: boolean;
  onToExpensesChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const add = useAddActReceipt(actId, projectId);
  const update = useUpdateActReceipt(actId, projectId);
  const remove = useDeleteActReceipt(actId, projectId);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WorkActReceiptResponse | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WorkActReceiptResponse | null>(null);
  const [viewing, setViewing] = useState<WorkActReceiptResponse | null>(null);

  const total = receipts.reduce((sum, r) => sum + r.amount, 0);

  const openAdd = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (r: WorkActReceiptResponse) => { setEditing(r); setFormOpen(true); };

  const onSubmit = async (v: { label: string; amount: number; issuedAt: string | null; file: File | null }) => {
    try {
      if (editing) {
        await update.mutateAsync({
          receiptId: editing.id,
          req: { label: v.label, amount: v.amount, issuedAt: v.issuedAt },
        });
      } else {
        await add.mutateAsync({ label: v.label, amount: v.amount, issuedAt: v.issuedAt, file: v.file });
      }
      setFormOpen(false);
      setEditing(null);
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center gap-1.5">
        <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted">{t('acts.receiptsTitle')}</h3>
        <InfoPopover text={t('acts.receiptsInfo')} />
      </div>

      {receipts.length === 0 && (
        <p className="mb-2 text-sm text-muted">{t('acts.receiptsEmpty')}</p>
      )}

      <div className="space-y-2">
        {receipts.map((r) => (
          <div key={r.id} className="rounded-card border border-border bg-surface p-3">
            <div className="flex items-start gap-3">
              {r.hasPhoto ? (
                <button type="button" onClick={() => setViewing(r)} aria-label={t('acts.receiptPhoto')}
                  className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-surface-sunken">
                  <ReceiptThumb actId={actId} receiptId={r.id} />
                </button>
              ) : (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-xl text-faint">🧾</div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium text-primary">{r.label}</span>
                  <span className="whitespace-nowrap text-sm font-semibold text-primary">{formatMoney(r.amount)}</span>
                </div>
                {r.issuedAt && <p className="mt-0.5 text-xs text-muted">{r.issuedAt}</p>}
                {!signed && (
                  <div className="mt-2 flex gap-3">
                    <button type="button" className="text-xs font-semibold text-brand" onClick={() => openEdit(r)}>
                      {t('common.edit')}
                    </button>
                    <button type="button" className="text-xs font-semibold text-danger" onClick={() => setConfirmDelete(r)}>
                      {t('common.delete')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {receipts.length > 0 && (
        <div className="mt-2 flex justify-between rounded-card bg-surface-sunken px-3.5 py-2.5 text-sm font-semibold text-primary">
          <span>{t('acts.receiptsTotal')}</span><span>{formatMoney(total)}</span>
        </div>
      )}

      {!signed && (
        <>
          <button type="button" onClick={openAdd} className="mt-2 text-sm font-semibold text-brand">
            {t('acts.addReceipt')}
          </button>
          {receipts.length > 0 && (
            <label className="mt-3 flex items-start gap-2">
              <input type="checkbox" checked={toExpenses} onChange={() => onToExpensesChange(!toExpenses)}
                className="mt-0.5 h-4 w-4 accent-brand" />
              <span className="flex items-center gap-1 text-sm text-secondary">
                {t('acts.receiptsToExpenses')}
                <InfoPopover text={t('acts.receiptsToExpensesInfo')} />
              </span>
            </label>
          )}
        </>
      )}

      <ReceiptForm
        open={formOpen}
        editing={editing}
        busy={add.isPending || update.isPending}
        onSubmit={onSubmit}
        onClose={() => { setFormOpen(false); setEditing(null); }}
      />

      <Modal open={viewing !== null} onClose={() => setViewing(null)} title={viewing?.label ?? ''}>
        {viewing && <ReceiptFullPhoto actId={actId} receiptId={viewing.id} alt={viewing.label} />}
      </Modal>

      <ConfirmDialog open={confirmDelete !== null} title={t('acts.receiptDeleteTitle')}
        message={t('acts.receiptDeleteConfirm')} confirmLabel={t('common.delete')} loading={remove.isPending}
        onConfirm={() => {
          if (!confirmDelete) return;
          remove.mutate(confirmDelete.id, {
            onSuccess: () => setConfirmDelete(null),
            onError: (err) => toast.error(toAppError(err).message),
          });
        }}
        onClose={() => setConfirmDelete(null)} />
    </div>
  );
}

/** Add / edit one receipt. The photo is set once, at upload — editing touches only the text. */
function ReceiptForm({
  open, editing, busy, onSubmit, onClose,
}: {
  open: boolean;
  editing: WorkActReceiptResponse | null;
  busy: boolean;
  onSubmit: (v: { label: string; amount: number; issuedAt: string | null; file: File | null }) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [issuedAt, setIssuedAt] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [seededFor, setSeededFor] = useState<string | null>(null);

  // Seed once per opening: an «edit» carries the receipt's values, an «add» starts blank. Keyed on
  // the receipt id (or '' for a new one) so reopening the same dialog reseeds.
  const key = open ? (editing?.id ?? '') : null;
  if (key !== seededFor) {
    setSeededFor(key);
    setLabel(editing?.label ?? '');
    setAmount(editing == null ? '' : String(editing.amount));
    setIssuedAt(editing?.issuedAt ?? '');
    setFile(null);
  }

  const num = (s: string): number => {
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };
  const valid = label.trim() !== '' && num(amount) > 0;

  return (
    <Modal open={open} onClose={onClose} title={t(editing ? 'acts.receiptEditTitle' : 'acts.receiptAddTitle')}>
      <div className="space-y-3">
        <Field label={t('acts.receiptLabel')}>
          <Input value={label} placeholder={t('acts.receiptLabelHint')} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('acts.receiptAmount')}>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label={t('acts.receiptDate')}>
            <Input type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
          </Field>
        </div>
        {!editing && (
          <Field label={t('acts.receiptPhoto')}>
            {/* capture="environment" so a phone opens the camera straight at the paper. */}
            <input type="file" accept="image/*" capture="environment"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-surface-sunken file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand" />
          </Field>
        )}
        <Button fullWidth loading={busy} disabled={!valid}
          onClick={() => onSubmit({
            label: label.trim(), amount: num(amount),
            issuedAt: issuedAt.trim() === '' ? null : issuedAt,
            file,
          })}>
          {t(editing ? 'common.save' : 'acts.receiptAdd')}
        </Button>
      </div>
    </Modal>
  );
}

/** Receipt photos stream from an authenticated endpoint, so <img src> can't carry the token —
 *  same bearer-fetch-to-blob-URL path the object photos use. */
function ReceiptThumb({ actId, receiptId }: { actId: string; receiptId: string }) {
  const { url, failed } = usePhotoBlobUrl(actsApi.receiptFileUrl(actId, receiptId));
  if (failed) return <div className="flex h-full w-full items-center justify-center text-faint">⚠️</div>;
  if (!url) return <div className="flex h-full w-full items-center justify-center"><Spinner size="sm" /></div>;
  return <img src={url} alt="" className="h-full w-full object-cover" />;
}

function ReceiptFullPhoto({ actId, receiptId, alt }: { actId: string; receiptId: string; alt: string }) {
  const { t } = useTranslation();
  const { url, failed } = usePhotoBlobUrl(actsApi.receiptFileUrl(actId, receiptId));
  if (failed) return <p className="py-8 text-center text-sm text-muted">⚠️ {t('photos.loadFailed')}</p>;
  if (!url) return <div className="py-8 text-center text-brand"><Spinner /></div>;
  return <img src={url} alt={alt} className="max-h-[70vh] w-full object-contain" />;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium text-muted">{label}</span>{children}</label>;
}
