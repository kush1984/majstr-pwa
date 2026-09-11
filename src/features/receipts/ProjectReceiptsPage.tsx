import { useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { onlineManager } from '@tanstack/react-query';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Modal } from '@/components/Modal.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { OfflineNotCached } from '@/components/OfflineNotCached.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { InfoPopover } from '@/components/InfoPopover.tsx';
import { toast } from '@/hooks/useToast.ts';
import { useOnlineGuard } from '@/hooks/useOnlineGuard.ts';
import { toAppError } from '@/api/errors.ts';
import { formatMoneyExact } from '@/lib/format.ts';
import { routes } from '@/lib/config.ts';
import { decodeQrFromFile, looksFiscal } from '@/lib/qr.ts';
import { photosApi } from '@/api/photos.ts';
import { projectReceiptsApi } from '@/api/projectReceipts.ts';
import { ReceiptOrdinal, ReceiptPhoto } from '@/features/photos/ReceiptPhoto.tsx';
import {
  useDeleteProjectReceipt,
  useProjectReceipts,
  useUpdateProjectReceipt,
} from './useProjectReceipts.ts';
import { useProjectReceiptBatch, type ProjectReceiptBatchChoice } from './useProjectReceiptBatch.ts';
import type { ProjectReceiptResponse, ReceiptRecognizeResponse } from '@/api/types.ts';

interface ReceiptFormValue {
  label: string;
  amount: number;
  issuedAt: string | null;
}

/**
 * «Чеки обʼєкта» (V129) — the paper from the builders' merchant, filed against the OBJECT.
 *
 * <p><b>The whole screen is built so that the till involves no economics.</b> Camera or gallery, the
 * sum fills itself, done — and nothing has been decided about whose money it was, because a receipt
 * here is «клієнт відшкодовує» by default (master's ruling: material is mostly bought with the
 * client's money). The one economic question this screen ever asks is a single tap, «це моя
 * витрата», and only that tap turns a receipt into an object expense.</p>
 *
 * <p>Its own full-screen route rather than a tab, for the same reason the shopping list has one: it
 * is one job done in one go, straight after the shop. The list's «Додати чек» button lands here.</p>
 *
 * <p>Unlike an act's receipts, these have NO offline path — there is no outbox entity for them, so
 * instead of queueing bytes it cannot send, the add says plainly that a connection is needed. That
 * is the honest version of a pile of photos that would otherwise look saved and be gone.</p>
 */
export function ProjectReceiptsPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  const list = useProjectReceipts(projectId);
  const update = useUpdateProjectReceipt(projectId);
  const remove = useDeleteProjectReceipt(projectId);
  const batch = useProjectReceiptBatch(projectId);
  const { online, guard, offlineTitle } = useOnlineGuard();

  const [picked, setPicked] = useState<File[] | null>(null);
  const [editing, setEditing] = useState<ProjectReceiptResponse | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProjectReceiptResponse | null>(null);
  const [readingId, setReadingId] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  // Three screens can open this one — the shopping list, the object and the economy card — so «←»
  // returns to whichever did. The object stays the fallback: a reload loses the state.
  const back = (location.state as { from?: string } | null)?.from ?? routes.project(projectId);

  const onPick = (picked: FileList | null) => {
    const files = Array.from(picked ?? []);
    if (files.length > 0) setPicked(files);
  };

  const startBatch = async (choice: ProjectReceiptBatchChoice) => {
    const files = picked ?? [];
    setPicked(null);
    if (files.length === 0) return;
    const out = await batch.run(files, choice);
    // Nothing was uploaded and nothing was queued — say so instead of reporting a count of 0.
    if (out.offline) {
      toast.error(t('offline.needConnection'));
      return;
    }
    if (out.error) toast.error(out.error);
    if (out.saved === 0) return;
    if (out.unread > 0) toast.info(t('receipts.batchUnread', { count: out.unread }));
    else toast.success(t('receipts.batchDone', { count: out.saved }));
  };

  /**
   * Read a receipt that is ALREADY stored, cheapest rung first: the full QR ladder over its own
   * photo (local, free, no model call) and only then the model. The batch clips each photo's QR
   * budget so a pile can't freeze the phone — here there is one receipt and all the time in the
   * world, so a code the batch missed often reads on this second, unhurried pass.
   */
  const recognizeStored = async (receiptId: string): Promise<ReceiptRecognizeResponse | null> => {
    try {
      const blob = await photosApi.fetchBlob(projectReceiptsApi.fileUrl(projectId, receiptId));
      const payload = await decodeQrFromFile(new File([blob], 'receipt', { type: blob.type }));
      if (payload && looksFiscal(payload)) {
        const read = await projectReceiptsApi.readQr(projectId, payload);
        if (read.recognized && read.amount != null) return read;
      }
    } catch {
      // No readable fiscal code on this paper — the common case. Fall through to the model.
    }
    return projectReceiptsApi.recognizeStored(projectId, receiptId);
  };

  /** The «✨ Розпізнати» button on an unpriced card: fill the sum, nothing else. */
  const readCard = async (r: ProjectReceiptResponse) => {
    setReadingId(r.id);
    try {
      const read = await recognizeStored(r.id);
      if (!read?.recognized || read.amount == null) {
        toast.info(t('receipts.recognizeFailed'));
        return;
      }
      await update.mutateAsync({
        receiptId: r.id,
        req: {
          label: read.label?.trim() || r.label,
          amount: read.amount,
          issuedAt: read.issuedAt ?? r.issuedAt,
          // `reimbursable` deliberately omitted — three-valued on the server, and reading a sum off
          // the paper says nothing about whose money it was.
          fiscalFn: read.fiscalFn,
          fiscalId: read.fiscalId,
        },
      });
    } catch (err) {
      toast.error(toAppError(err).message);
    } finally {
      setReadingId(null);
    }
  };

  /**
   * The one economic decision on this screen, and it is a single tap. The PATCH carries the row's
   * whole text state because the server requires both fields — send only the flag and the label and
   * amount are erased.
   */
  const toggleOwn = (r: ProjectReceiptResponse) => {
    update.mutate(
      {
        receiptId: r.id,
        req: {
          label: r.label,
          amount: r.amount,
          issuedAt: r.issuedAt,
          reimbursable: !r.reimbursable,
        },
      },
      { onError: (err) => toast.error(toAppError(err).message) },
    );
  };

  const onEditSubmit = async (v: ReceiptFormValue) => {
    if (!editing) return;
    try {
      await update.mutateAsync({
        receiptId: editing.id,
        req: { label: v.label, amount: v.amount, issuedAt: v.issuedAt },
      });
      setEditing(null);
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  if (list.isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas">
        <Spinner />
      </div>
    );
  }

  const notCached = list.isError && !onlineManager.isOnline();
  const totals = list.data;
  const unpriced = totals?.unpricedCount ?? 0;

  return (
    <div className="min-h-dvh bg-canvas">
      <div className="mx-auto max-w-xl px-4 pb-28 pt-4 sm:px-6">
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(back)}
            aria-label={t('common.back')}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-lg text-primary"
          >
            ←
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-extrabold tracking-tight text-primary">
              {t('receipts.title')}
            </h1>
            {items.length > 0 && (
              <p className="truncate text-xs text-muted">
                {t('receipts.counts', { count: items.length })}
              </p>
            )}
          </div>
        </div>

        {notCached ? (
          <OfflineNotCached what={t('receipts.title')} />
        ) : (
          <>
            {/* The receivable leads, because it is the answer to the master's own question: this
                money is coming back to him, it is not a cost he has swallowed. «Мої витрати» shows
                only once something is actually filed that way — a permanent 0 ₴ beside it would
                invite exactly the pondering this screen exists to remove. */}
            {items.length > 0 && totals && (
              <div className="mb-4 rounded-card border border-border bg-surface p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1 text-xs text-muted">
                    {t('receipts.reimbursableTotal')}
                    <InfoPopover
                      text={t('receipts.reimbursableInfo')}
                      label={t('receipts.reimbursableTotal')}
                    />
                  </span>
                  <span className="font-mono text-base font-bold tabular-nums text-primary">
                    {formatMoneyExact(totals.reimbursableTotal)}
                  </span>
                </div>
                {totals.ownTotal > 0 && (
                  <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
                    <span className="flex items-center gap-1 text-xs text-muted">
                      {t('receipts.ownTotal')}
                      <InfoPopover text={t('receipts.ownInfo')} label={t('receipts.ownTotal')} />
                    </span>
                    <span className="font-mono text-sm font-semibold tabular-nums text-secondary">
                      {formatMoneyExact(totals.ownTotal)}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Named per phase, not a bare spinner: «saving» must not be interrupted, «reading» is
                enrichment the master is free to walk away from. */}
            {batch.progress != null && (
              <div className="mb-4 rounded-card border border-border bg-surface-sunken p-3">
                <p className="flex items-center gap-2 text-sm text-secondary">
                  <Spinner size="sm" />
                  {t(
                    batch.progress.phase === 'saving'
                      ? 'receipts.batchSaving'
                      : 'receipts.batchReading',
                    { done: batch.progress.done, total: batch.progress.total },
                  )}
                </p>
                {batch.progress.phase === 'reading' && (
                  <button
                    type="button"
                    className="mt-2 text-xs font-semibold text-brand"
                    onClick={batch.cancel}
                  >
                    {t('receipts.batchStopReading')}
                  </button>
                )}
              </div>
            )}

            {unpriced > 0 && (
              <p className="mb-4 rounded-card border border-warning/40 bg-warning/10 p-2.5 text-xs text-secondary">
                {t('receipts.unpricedSummary', { count: unpriced })}
              </p>
            )}

            {items.length === 0 && batch.progress == null ? (
              <EmptyState
                icon="🧾"
                title={t('receipts.emptyTitle')}
                text={t('receipts.emptyText')}
              />
            ) : (
              <ul className="space-y-2">
                {items.map((r, i) => (
                  <ReceiptCard
                    key={r.id}
                    receipt={r}
                    n={i + 1}
                    projectId={projectId}
                    online={online}
                    reading={readingId === r.id}
                    readingBlocked={readingId != null}
                    busy={update.isPending}
                    onRead={() => void readCard(r)}
                    onToggleOwn={() => toggleOwn(r)}
                    onEdit={() => setEditing(r)}
                    onDelete={() => setConfirmDelete(r)}
                  />
                ))}
              </ul>
            )}

            {/* Two pick paths, exactly as in the act's receipts (master: «так як ми робимо в
                актах»): capture="environment" alone locks a phone out of receipts already
                photographed, and the gallery takes MANY because the master photographs the day's
                pile and wants it all in at once. */}
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                onPick(e.target.files);
                e.target.value = '';
              }}
            />
            <input
              ref={galleryRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                onPick(e.target.files);
                e.target.value = '';
              }}
            />
            <div className="mt-4 flex gap-2">
              <Button
                variant="secondary"
                fullWidth
                disabled={batch.progress != null || !online}
                title={offlineTitle}
                onClick={guard(() => cameraRef.current?.click())}
              >
                📷 {t('receipts.takePhoto')}
              </Button>
              <Button
                variant="secondary"
                fullWidth
                disabled={batch.progress != null || !online}
                title={offlineTitle}
                onClick={guard(() => galleryRef.current?.click())}
              >
                🖼 {t('receipts.pickFiles')}
              </Button>
            </div>
            {/* Said before he tries, not after it fails: a receipt has no offline queue, unlike an
                act's, and a master who has learned the app works without signal deserves the
                exception named out loud. */}
            {!online && (
              <p className="mt-2 text-center text-xs text-muted">{t('receipts.offlineHint')}</p>
            )}
          </>
        )}
      </div>

      <BatchChoiceSheet
        files={picked}
        onClose={() => setPicked(null)}
        onStart={(choice) => void startBatch(choice)}
      />

      <ReceiptForm
        projectId={projectId}
        editing={editing}
        busy={update.isPending}
        onSubmit={(v) => void onEditSubmit(v)}
        onClose={() => setEditing(null)}
        recognize={recognizeStored}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        title={t('receipts.deleteTitle')}
        message={t('receipts.deleteConfirm')}
        confirmLabel={t('common.delete')}
        loading={remove.isPending}
        onConfirm={() => {
          if (!confirmDelete) return;
          remove.mutate(confirmDelete.id, {
            onSuccess: () => setConfirmDelete(null),
            onError: (err) => toast.error(toAppError(err).message),
          });
        }}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  );
}

/**
 * One receipt: the paper on the left, what it cost on the right, and one tap deciding whose money
 * it was. The «це моя витрата» toggle is a plain row action rather than a form field on purpose —
 * it is the only economics on this screen, and it must cost one gesture, not a dialog.
 */
function ReceiptCard({
  receipt: r,
  n,
  projectId,
  online,
  reading,
  readingBlocked,
  busy,
  onRead,
  onToggleOwn,
  onEdit,
  onDelete,
}: {
  receipt: ProjectReceiptResponse;
  n: number;
  projectId: string;
  online: boolean;
  reading: boolean;
  readingBlocked: boolean;
  busy: boolean;
  onRead: () => void;
  onToggleOwn: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const needsAmount = r.amount <= 0;

  return (
    <li
      className={
        'rounded-card border bg-surface p-3 ' + (needsAmount ? 'border-warning' : 'border-border')
      }
    >
      <div className="flex items-start gap-3">
        <ReceiptOrdinal n={n} className="pt-0.5" />
        {r.hasPhoto ? (
          <ReceiptPhoto
            variant="thumb"
            title={r.label}
            source={{ kind: 'stored', fileUrl: projectReceiptsApi.fileUrl(projectId, r.id) }}
          />
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-xl text-faint">
            🧾
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span className="text-sm font-medium text-primary">{r.label}</span>
            {/* Kopecks as typed — money display must not round. */}
            {needsAmount ? (
              <span className="whitespace-nowrap text-sm font-semibold text-warning">
                {t('receipts.noAmount')}
              </span>
            ) : (
              <span className="whitespace-nowrap text-sm font-semibold text-primary">
                {formatMoneyExact(r.amount)}
              </span>
            )}
          </div>
          {r.issuedAt && <p className="mt-0.5 text-xs text-muted">{r.issuedAt}</p>}
          {/* A WARNING, never a refusal (V129): the fiscal identity is only known after a QR read,
              so the same paper can legitimately be photographed twice before either copy is read. */}
          {r.duplicate && (
            <p className="mt-0.5 text-xs text-warning">{t('receipts.duplicateBadge')}</p>
          )}

          {/* The default state is stated, not implied: «клієнт відшкодовує» is the answer to the
              question the master would otherwise stop and ask himself at the till. */}
          <button
            type="button"
            disabled={busy}
            onClick={onToggleOwn}
            className={
              'mt-1.5 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ' +
              (r.reimbursable ? 'bg-brand-soft text-brand' : 'bg-surface-sunken text-secondary')
            }
          >
            {r.reimbursable ? `↩ ${t('receipts.reimbursableBadge')}` : `💸 ${t('receipts.ownBadge')}`}
          </button>
          <p className="mt-1 text-[11px] text-muted">
            {r.reimbursable ? t('receipts.markOwnHint') : t('receipts.markReimbursableHint')}
          </p>

          <div className="mt-2 flex flex-wrap gap-3">
            {needsAmount && online && (
              <button
                type="button"
                className="text-xs font-semibold text-brand"
                disabled={readingBlocked}
                onClick={onRead}
              >
                {reading ? t('receipts.recognizing') : `✨ ${t('receipts.recognizeOne')}`}
              </button>
            )}
            <button type="button" className="text-xs font-semibold text-brand" onClick={onEdit}>
              {t('common.edit')}
            </button>
            <button type="button" className="text-xs font-semibold text-danger" onClick={onDelete}>
              {t('common.delete')}
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

/**
 * The one question asked per batch, before anything is uploaded: read the sums automatically, or
 * just file the paper?
 *
 * <p>It exists because of the master's own report on the act's receipts — «з недостатньою швидкістю
 * інтернету довго думає і додавати чек не хоче». The photos land either way; the fiscal QR is not
 * part of the question, since it is local, exact and free, so it always runs.</p>
 *
 * <p>No «зберегти також у Фото» tick here, unlike the act's sheet: the object's create endpoint has
 * no such parameter, and these receipts already belong to the object.</p>
 */
function BatchChoiceSheet({
  files,
  onClose,
  onStart,
}: {
  files: File[] | null;
  onClose: () => void;
  onStart: (choice: ProjectReceiptBatchChoice) => void;
}) {
  const { t } = useTranslation();
  // Deliberately NOT reseeded per batch: a master who reads receipts one way reads the next pile
  // the same way, and re-ticking the same box every time is the friction this replaced.
  const [withAi, setWithAi] = useState(true);
  const count = files?.length ?? 0;

  return (
    <Modal open={files !== null} onClose={onClose} title={t('receipts.batchTitle', { count })}>
      <div className="space-y-3">
        <p className="text-sm text-secondary">{t('receipts.batchIntro', { count })}</p>

        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={withAi}
            onChange={() => setWithAi((v) => !v)}
            className="mt-0.5 h-4 w-4 accent-brand"
          />
          <span className="text-sm text-secondary">{t('receipts.batchWithAi')}</span>
        </label>
        <p className="-mt-1 pl-6 text-xs text-muted">{t('receipts.batchWithAiHint')}</p>

        <Button fullWidth onClick={() => onStart({ withAi })}>
          {t('receipts.batchStart', { count })}
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Edit one receipt's text and money. The photo is set once at upload and never replaced — it is the
 * receipt's proof, and swapping it under a row is not an edit.
 *
 * <p>A blank amount is a legal saved state here and stays one: unlike an act, an object has no
 * signature for an unpriced receipt to block, so «Зберегти» never waits for a sum.</p>
 */
function ReceiptForm({
  projectId,
  editing,
  busy,
  onSubmit,
  onClose,
  recognize,
}: {
  projectId: string;
  editing: ProjectReceiptResponse | null;
  busy: boolean;
  onSubmit: (v: ReceiptFormValue) => void;
  onClose: () => void;
  recognize: (receiptId: string) => Promise<ReceiptRecognizeResponse | null>;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [issuedAt, setIssuedAt] = useState('');
  const [reading, setReading] = useState(false);
  const [seededFor, setSeededFor] = useState<string | null>(null);

  const key = editing?.id ?? null;
  if (key !== seededFor) {
    setSeededFor(key);
    setLabel(editing?.label ?? '');
    setAmount(editing == null || editing.amount <= 0 ? '' : String(editing.amount));
    setIssuedAt(editing?.issuedAt ?? '');
    setReading(false);
  }

  const num = (s: string): number => {
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };
  // The server names a blank label «Чек №N», so there is always something here to keep.
  const valid = label.trim() !== '';
  // Nothing a read could still fill in — leaving the button live invites a slow call whose only
  // possible effect is to overwrite what the master just typed off the paper in front of him.
  const nothingToRead = valid && num(amount) > 0 && issuedAt.trim() !== '';

  const run = async () => {
    if (!editing) return;
    setReading(true);
    try {
      const read = await recognize(editing.id);
      if (!read?.recognized) {
        toast.info(t('receipts.recognizeFailed'));
        return;
      }
      // A label the master already typed is never overwritten — he named the shop, the reader only
      // guessed it.
      if (read.amount != null) setAmount(String(read.amount));
      if (read.issuedAt != null) setIssuedAt(read.issuedAt);
      setLabel((current) => (current.trim() === '' && read.label ? read.label : current));
      if (read.amount == null) toast.info(t('receipts.recognizePartial'));
    } catch (err) {
      toast.error(toAppError(err).message);
    } finally {
      setReading(false);
    }
  };

  return (
    <Modal open={editing !== null} onClose={onClose} title={t('receipts.editTitle')}>
      <div className="space-y-3">
        {/* The paper itself, right above the fields: checking a sum a reader guessed means looking
            at the receipt. Tap to open it full-size — a folded slip is unreadable at preview height. */}
        {editing?.hasPhoto && (
          <div>
            <ReceiptPhoto
              variant="preview"
              title={editing.label}
              source={{ kind: 'stored', fileUrl: projectReceiptsApi.fileUrl(projectId, editing.id) }}
            />
            <p className="mt-1 text-center text-xs text-muted">
              {t('receipts.checkAgainstPhoto')}
            </p>
          </div>
        )}

        <Field label={t('receipts.label')}>
          <Input
            value={label}
            placeholder={t('receipts.labelHint')}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('receipts.amount')}>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label={t('receipts.date')}>
            <Input type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
          </Field>
        </div>

        <div className="border-t border-border pt-3">
          <div className="flex items-center gap-1.5">
            <Button
              fullWidth
              variant="secondary"
              disabled={reading || nothingToRead}
              onClick={() => void run()}
            >
              ✨ {t('receipts.recognizeOne')}
            </Button>
            <InfoPopover text={t('receipts.recognizeInfo')} />
          </div>
          {nothingToRead && (
            <p className="mt-1.5 text-xs text-muted">{t('receipts.nothingToRead')}</p>
          )}
          {reading && (
            <p className="mt-2 flex items-center gap-2 text-sm text-muted">
              <Spinner size="sm" />
              {t('receipts.recognizing')}
            </p>
          )}
        </div>

        <Button
          fullWidth
          loading={busy}
          disabled={!valid || reading}
          onClick={() =>
            onSubmit({
              label: label.trim(),
              amount: num(amount),
              issuedAt: issuedAt.trim() === '' ? null : issuedAt,
            })
          }
        >
          {t('common.save')}
        </Button>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
