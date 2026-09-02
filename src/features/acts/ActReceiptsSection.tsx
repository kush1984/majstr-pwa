import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Modal } from '@/components/Modal.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { InfoPopover } from '@/components/InfoPopover.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { Section } from '@/components/Section.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { actsApi } from '@/api/acts.ts';
import { photosApi } from '@/api/photos.ts';
import { decodeQrFromFile, looksFiscal } from '@/lib/qr.ts';
import { formatMoneyExact } from '@/lib/format.ts';
import { ReceiptOrdinal, ReceiptPhoto } from '@/features/photos/ReceiptPhoto.tsx';
import { usePhotos } from '@/features/photos/usePhotos.ts';
import { usePlanLimits } from '@/features/plan/usePlanLimits.ts';
import { useOnline } from '@/lib/useOnline.ts';
import { dropQueuedReceipt, patchQueuedReceipt, type QueuedActReceipt } from './offlineReceipts.ts';
import { useDeleteActReceipt, useUpdateActReceipt } from './useActs.ts';
import { useReceiptBatch, type ReceiptBatchChoice } from './useReceiptBatch.ts';
import type { ActReceiptRecognizeResponse, WorkActReceiptResponse } from '@/api/types.ts';

/**
 * «Чеки та рахунки» on one act — the materials the master paid for out of pocket and re-bills to
 * the client (master request, act-receipts iteration). Deliberately NOT a parsed line list: the
 * master photographs the paper, the act carries «чек — сума» rows plus a subtotal. The photo is the
 * proof; the amount is what counts.
 *
 * <p>Receipts arrive as a BATCH and are saved before they are read (receipts-batch): the gallery
 * picker takes several photos at once, every one of them becomes a row immediately, and the sums
 * are filled in afterwards — by the receipt's own fiscal QR, by the model if the master asked, or
 * by hand. A row without a sum is a legal, visible, blocking state, not a lost receipt.</p>
 *
 * <p>There is deliberately no separate «scan a QR» action any more. A QR alone hands over no
 * photograph of the paper, and the photograph is the receipt's proof — so the QR is the first,
 * free rung inside «add from a photo» instead of a door of its own.</p>
 *
 * <p>A receipt can be partly RETURNED to the shop («купив цвяхів на 2000, залишилось на 500,
 * відніс назад»). That is one field on the purchase, not a second row: {@code amount} keeps saying
 * what the paper says — the client can open the photo — and {@code returnedAmount} is subtracted
 * from what is billed. The card shows both, because a card showing only 1 500 next to a photo
 * reading 2 000 looks like an error.</p>
 *
 * <p>A receipt can also be photographed with no connection at all (offline-act-receipts). Such a
 * row is real to the master immediately — it counts into «Разом за чеками» and «До сплати», its sum
 * and date are editable and deleting it is deleting it — but it lives in the outbox until the queue
 * drains, so it says it has not been sent yet, and the two things that need a server (reading the
 * paper, entering a return) say so instead of failing.</p>
 *
 * <p>Reading a receipt's POSITIONS into the act was removed (2026-08-28) — a receipt here answers
 * «скільки заплачено за матеріал і який папір це доводить», and the sum plus the photo answer it
 * whole. Rows created by the old flow still read as they were signed: {@code itemized} stays on the
 * response, keeps its muted amount and its «позиції в акті» line, and no new row can ever get it.</p>
 */
/** What the client is billed for one receipt: what the paper says, less what went back (V115).
 *  Exported so the act editor's totals panel and this section's subtotal can never disagree. */
export function billedOf(r: WorkActReceiptResponse): number {
  return r.amount - r.returnedAmount;
}

interface ReceiptFormValue {
  label: string;
  amount: number;
  returnedAmount: number;
  issuedAt: string | null;
}

export function ActReceiptsSection({
  actId,
  projectId,
  receipts,
  signed,
  queued,
  onQueuedChanged,
  toExpenses,
  onToExpensesChange,
  showPhotosInPdf,
  onShowPhotosInPdfChange,
}: {
  actId: string;
  projectId: string;
  /** Server rows AND anything still queued on the device, merged by the page — so this panel's
   *  subtotal and the editor's «До сплати» can never disagree about what exists. */
  receipts: WorkActReceiptResponse[];
  signed: boolean;
  /** The queued ones by id: they carry their photo as bytes and are corrected in the queue itself. */
  queued: Map<string, QueuedActReceipt>;
  /** An in-place queue edit changes no op COUNT, so the page has to be told to re-read. */
  onQueuedChanged: () => void;
  toExpenses: boolean;
  onToExpensesChange: (v: boolean) => void;
  /** PDF-appendix-only toggle: the portal always shows the photos. */
  showPhotosInPdf: boolean;
  onShowPhotosInPdfChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const update = useUpdateActReceipt(actId, projectId);
  const remove = useDeleteActReceipt(actId, projectId);

  const [picked, setPicked] = useState<File[] | null>(null);
  const [editing, setEditing] = useState<WorkActReceiptResponse | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WorkActReceiptResponse | null>(null);
  const [readingId, setReadingId] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  // Nothing on this screen is gated any more: the footer read — label/date/total — has always been
  // free, and the one PRO mode on it (the item table) went with the transfer it fed.
  const batch = useReceiptBatch(actId, projectId);

  // The optional gallery copy is governed by the object's own receipt-photo cap (5 on FREE), which
  // a pile can exhaust. The act's frozen copy never is — so this only decides what the choice sheet
  // promises about «Чеки», and is loaded only while that sheet is up.
  const { data: limits } = usePlanLimits();
  const { data: objectPhotos } = usePhotos(projectId, picked !== null);
  const galleryRoom =
    limits?.maxReceiptPhotosPerObject == null
      ? null
      : Math.max(
          0,
          limits.maxReceiptPhotosPerObject -
            (objectPhotos ?? []).filter((p) => p.source === 'RECEIPT').length,
        );

  // LEGACY rows only: a receipt whose positions were carried into the act back when that was
  // possible is billed by those lines, so its own amount is reference. Nothing creates one now.
  const total = receipts.filter((r) => !r.itemized).reduce((sum, r) => sum + billedOf(r), 0);
  // «Priced» is about the paper, not about what survives the return: a receipt fully handed back
  // bills nothing and must not block signing, while a receipt nobody has read yet must.
  const unpriced = receipts.filter((r) => r.amount <= 0).length;

  const onPick = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length > 0) setPicked(files);
  };

  const startBatch = async (choice: ReceiptBatchChoice) => {
    const files = picked ?? [];
    setPicked(null);
    if (files.length === 0) return;
    const out = await batch.run(files, choice);
    if (out.error) toast.error(out.error);
    if (out.saved === 0) return;
    // Offline the photos were not «not read» — they have not even been sent yet, and «не вдалося
    // прочитати» would name a failure that did not happen.
    if (out.offline) toast.success(t('acts.receiptBatchQueued', { count: out.saved }));
    else if (out.unread > 0) toast.info(t('acts.receiptBatchUnread', { count: out.unread }));
    else toast.success(t('acts.receiptBatchDone', { count: out.saved }));
  };

  /**
   * Read a receipt that is ALREADY stored, cheapest rung first: the full QR ladder over its own
   * photo (local, free, no model) and only then the model. The batch gives each photo a clipped QR
   * budget so ten of them can't freeze the phone — here there is one receipt and all the time in
   * the world, so a code the batch missed often reads on this second, unhurried pass.
   */
  const recognizeStored = async (receiptId: string): Promise<ActReceiptRecognizeResponse | null> => {
    try {
      const blob = await photosApi.fetchBlob(actsApi.receiptFileUrl(actId, receiptId));
      const payload = await decodeQrFromFile(new File([blob], 'receipt', { type: blob.type }));
      if (payload && looksFiscal(payload)) {
        const read = await actsApi.readReceiptQr(actId, payload);
        if (read.recognized && read.amount != null) return read;
      }
    } catch {
      // No readable fiscal code on this paper — the common case. Fall through to the model.
    }
    return actsApi.recognizeStoredReceipt(actId, receiptId);
  };

  /** The «✨ Розпізнати» button on an unpriced card: fill the sum, nothing else. */
  const readCard = async (r: WorkActReceiptResponse) => {
    setReadingId(r.id);
    try {
      const read = await recognizeStored(r.id);
      if (!read?.recognized || read.amount == null) {
        toast.info(t('acts.receiptRecognizeFailed'));
        return;
      }
      await update.mutateAsync({
        receiptId: r.id,
        req: {
          label: read.label?.trim() || r.label,
          amount: read.amount,
          // The request carries the row's whole state, so a read that skipped the return field
          // would silently erase a return the master already typed.
          returnedAmount: r.returnedAmount,
          issuedAt: read.issuedAt ?? r.issuedAt,
        },
      });
    } catch (err) {
      toast.error(toAppError(err).message);
    } finally {
      setReadingId(null);
    }
  };

  const onEditSubmit = async (v: ReceiptFormValue) => {
    if (!editing) return;
    try {
      // A receipt that has not synced has no server row to PATCH — the queued create IS the row, so
      // the correction goes into it. If the queue drained while the dialog was open the patch finds
      // nothing and we fall through to the ordinary update: by then the row does exist.
      if (queued.has(editing.id) && (await patchQueuedReceipt(editing.id, {
        label: v.label, amount: v.amount, issuedAt: v.issuedAt,
      }))) {
        onQueuedChanged();
        setEditing(null);
        return;
      }
      await update.mutateAsync({
        receiptId: editing.id,
        req: { label: v.label, amount: v.amount, returnedAmount: v.returnedAmount, issuedAt: v.issuedAt },
      });
      setEditing(null);
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  // No header `aside` on this panel, unlike the works ones: it ends with its own labelled «Разом за
  // чеками», and the same figure twice on one phone screen is noise.
  return (
    <Section title={t('acts.receiptsTitle')} info={t('acts.receiptsInfo')}>

      {receipts.length === 0 && batch.progress == null && (
        <p className="mb-2 text-sm text-muted">{t('acts.receiptsEmpty')}</p>
      )}

      {/* Named per phase, not a bare spinner: «saving» is the part that must not be interrupted,
          «reading» is enrichment the master is free to walk away from — and telling them apart is
          the difference between «зачекай» and «можеш іти». */}
      {batch.progress != null && (
        <div className="mb-2 rounded-card border border-border bg-surface-sunken p-3">
          <p className="flex items-center gap-2 text-sm text-secondary">
            <Spinner size="sm" />
            {t(batch.progress.phase === 'saving' ? 'acts.receiptBatchSaving' : 'acts.receiptBatchReading', {
              done: batch.progress.done, total: batch.progress.total,
            })}
          </p>
          {batch.progress.phase === 'reading' && (
            <button type="button" className="mt-2 text-xs font-semibold text-brand" onClick={batch.cancel}>
              {t('acts.receiptBatchStopReading')}
            </button>
          )}
        </div>
      )}

      {unpriced > 0 && (
        <p className="mb-2 rounded-card border border-warning/40 bg-warning/10 p-2.5 text-xs text-secondary">
          {t('acts.receiptsUnpricedSummary', { count: unpriced })}
        </p>
      )}

      <ul className="space-y-2">
        {receipts.map((r, i) => {
          const needsAmount = r.amount <= 0;
          const returned = r.returnedAmount > 0;
          const pending = queued.get(r.id) ?? null;
          return (
            <li key={r.id}
              className={'rounded-card border bg-surface p-3 '
                + (needsAmount ? 'border-warning' : 'border-border')}>
              <div className="flex items-start gap-3">
                {/* The ordinal leads the row (master feedback): it numbers the receipt, not its
                    name, so it belongs ahead of the photo rather than glued to the label. It is the
                    row's POSITION in the date order; «Чек №N» is the name the server gave it on
                    upload and never moves — that name is frozen into the PDF and the doc_hash on
                    signing, so renumbering it under the master would make the signed paper and this
                    list disagree. */}
                <ReceiptOrdinal n={i + 1} className="pt-0.5" />
                {pending ? (
                  // The photo is on the device, not on the server: rendering it from the queued
                  // bytes is what makes an unsent receipt look like a receipt and not like a stub.
                  <ReceiptPhoto variant="thumb" title={r.label || t('acts.receiptQueuedName')}
                    source={{ kind: 'file', file: pending.file }} />
                ) : r.hasPhoto ? (
                  <ReceiptPhoto variant="thumb" title={r.label}
                    source={{ kind: 'stored', fileUrl: actsApi.receiptFileUrl(actId, r.id) }} />
                ) : (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-xl text-faint">🧾</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    {/* «Чек №N» is the server's name and only the server can give it: N counts the
                        act's receipts, which a phone holding three unsent photos cannot know. Until
                        it lands the row says what it is instead of showing an empty line. */}
                    <span className={'text-sm font-medium ' + (r.label ? 'text-primary' : 'text-muted')}>
                      {r.label || t('acts.receiptQueuedName')}
                    </span>
                    {/* Kopecks as typed (master feedback) — money display must not round. An itemized
                        receipt's amount is muted reference: its positions bill it in the act. */}
                    {needsAmount ? (
                      <span className="whitespace-nowrap text-sm font-semibold text-warning">
                        {t('acts.receiptNoAmount')}
                      </span>
                    ) : (
                      <span className={'whitespace-nowrap text-sm font-semibold '
                        + (r.itemized ? 'text-muted' : 'text-primary')}>
                        {formatMoneyExact(r.itemized ? r.amount : billedOf(r))}
                      </span>
                    )}
                  </div>
                  {returned && (
                    <p className="mt-0.5 text-xs text-muted">
                      {t('acts.receiptReturnedBadge', {
                        amount: formatMoneyExact(r.amount),
                        returned: formatMoneyExact(r.returnedAmount),
                      })}
                    </p>
                  )}
                  {r.itemized && (
                    <p className="mt-0.5 text-xs text-muted">{t('acts.receiptItemizedBadge')}</p>
                  )}
                  {r.issuedAt && <p className="mt-0.5 text-xs text-muted">{r.issuedAt}</p>}
                  {pending && <p className="mt-0.5 text-xs text-warning">{t('acts.receiptQueuedBadge')}</p>}
                  {(needsAmount || !r.issuedAt) && !signed && (
                    <p className="mt-1 text-xs text-warning">
                      {t(needsAmount ? 'acts.receiptIncomplete' : 'acts.receiptIncompleteDate')}
                    </p>
                  )}
                  {!signed && (
                    <div className="mt-2 flex flex-wrap gap-3">
                      {/* The read works on the STORED photo, so an unsent receipt has nothing to
                          read yet — and every rung of it needs the network in any case. */}
                      {needsAmount && !pending && online && (
                        <button type="button" className="text-xs font-semibold text-brand"
                          disabled={readingId != null} onClick={() => void readCard(r)}>
                          {readingId === r.id ? t('acts.receiptRecognizing') : `✨ ${t('acts.receiptRecognizeOne')}`}
                        </button>
                      )}
                      <button type="button" className="text-xs font-semibold text-brand" onClick={() => setEditing(r)}>
                        {t('common.edit')}
                      </button>
                      <button type="button" className="text-xs font-semibold text-danger" onClick={() => setConfirmDelete(r)}>
                        {t('common.delete')}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {receipts.length > 0 && (
        <div className="mt-2 flex justify-between rounded-card bg-surface-sunken px-3.5 py-2.5 text-sm font-semibold text-primary">
          <span>{t('acts.receiptsTotal')}</span><span>{formatMoneyExact(total)}</span>
        </div>
      )}

      {!signed && (
        <>
          {/* Two pick paths (master feedback): the camera AND the gallery — capture="environment"
              alone locked phones out of receipts already photographed. The gallery takes MANY: the
              master photographs the day's pile and wants it all in at once. */}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { onPick(e.target.files); e.target.value = ''; }} />
          <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => { onPick(e.target.files); e.target.value = ''; }} />
          <div className="mt-2 flex gap-2">
            <Button variant="secondary" disabled={batch.progress != null} onClick={() => cameraRef.current?.click()}>
              📷 {t('acts.receiptTakePhoto')}
            </Button>
            <Button variant="secondary" disabled={batch.progress != null} onClick={() => galleryRef.current?.click()}>
              🖼 {t('acts.receiptPickFiles')}
            </Button>
          </div>
          {receipts.length > 0 && (
            <>
              <label className="mt-3 flex items-start gap-2">
                <input type="checkbox" checked={toExpenses} onChange={() => onToExpensesChange(!toExpenses)}
                  className="mt-0.5 h-4 w-4 accent-brand" />
                <span className="flex items-center gap-1 text-sm text-secondary">
                  {t('acts.receiptsToExpenses')}
                  <InfoPopover text={t('acts.receiptsToExpensesInfo')} />
                </span>
              </label>
              <label className="mt-2 flex items-start gap-2">
                <input type="checkbox" checked={showPhotosInPdf} onChange={() => onShowPhotosInPdfChange(!showPhotosInPdf)}
                  className="mt-0.5 h-4 w-4 accent-brand" />
                <span className="flex items-center gap-1 text-sm text-secondary">
                  {t('acts.receiptPhotosInPdf')}
                  <InfoPopover text={t('acts.receiptPhotosInPdfInfo')} />
                </span>
              </label>
            </>
          )}
        </>
      )}

      <BatchChoiceSheet
        files={picked}
        online={online}
        galleryRoom={galleryRoom}
        onClose={() => setPicked(null)}
        onStart={(choice) => void startBatch(choice)}
      />

      <ReceiptForm
        actId={actId}
        editing={editing}
        pending={editing ? (queued.get(editing.id) ?? null) : null}
        busy={update.isPending}
        onSubmit={onEditSubmit}
        onClose={() => setEditing(null)}
        recognize={recognizeStored}
      />

      <ConfirmDialog open={confirmDelete !== null} title={t('acts.receiptDeleteTitle')}
        message={t('acts.receiptDeleteConfirm')} confirmLabel={t('common.delete')} loading={remove.isPending}
        onConfirm={() => {
          if (!confirmDelete) return;
          // Dropping the queued create IS the delete — there is nothing on the server to ask about.
          if (queued.has(confirmDelete.id)) {
            void dropQueuedReceipt(confirmDelete.id).then((dropped) => {
              if (!dropped) return;
              onQueuedChanged();
              setConfirmDelete(null);
            });
            return;
          }
          remove.mutate(confirmDelete.id, {
            onSuccess: () => setConfirmDelete(null),
            onError: (err) => toast.error(toAppError(err).message),
          });
        }}
        onClose={() => setConfirmDelete(null)} />
    </Section>
  );
}

/**
 * The one question asked per batch, before anything is uploaded: read the sums automatically, or
 * just file the paper?
 *
 * <p>It exists because of the master's own report — «з недостатньою швидкістю інтернету довго думає
 * і додавати чек не хоче». Reading used to be unconditional and in front of the save, so a weak
 * link cost him the receipt. Making it a choice he takes knowingly, with the slow-link case named
 * in plain words right under the tick, is the honest version of that: the photos land either way.
 * The fiscal QR is not part of the question — it is local, exact and free, so it always runs.</p>
 *
 * <p>With no connection there is no question left to ask: neither the tax service behind the QR nor
 * the model can be reached, so the tick is off and locked and the sheet says the photos will be sent
 * when the link comes back. It stays visible rather than disappearing — the master ticked it last
 * time and needs to see why it is not happening now.</p>
 */
function BatchChoiceSheet({
  files, online, galleryRoom, onClose, onStart,
}: {
  files: File[] | null;
  online: boolean;
  /** How many more receipt photos fit in the object's gallery; null = unlimited. */
  galleryRoom: number | null;
  onClose: () => void;
  onStart: (choice: ReceiptBatchChoice) => void;
}) {
  const { t } = useTranslation();
  const [withAi, setWithAi] = useState(true);
  const [saveToPhotos, setSaveToPhotos] = useState(false);
  const reading = withAi && online;

  // Deliberately NOT reseeded per batch: a master who reads receipts one way reads the next pile
  // the same way, and re-ticking the same boxes every time is the friction this replaced.
  const count = files?.length ?? 0;

  return (
    <Modal open={files !== null} onClose={onClose} title={t('acts.receiptBatchTitle', { count })}>
      <div className="space-y-3">
        <p className="text-sm text-secondary">{t('acts.receiptBatchIntro', { count })}</p>

        <label className="flex items-start gap-2">
          <input type="checkbox" checked={reading} disabled={!online} onChange={() => setWithAi((v) => !v)}
            className="mt-0.5 h-4 w-4 accent-brand" />
          <span className={'text-sm ' + (online ? 'text-secondary' : 'text-muted')}>
            {t('acts.receiptBatchWithAi')}
          </span>
        </label>
        <p className="-mt-1 pl-6 text-xs text-muted">
          {t(online ? 'acts.receiptBatchWithAiHint' : 'acts.receiptBatchOffline')}
        </p>

        <label className="flex items-start gap-2">
          <input type="checkbox" checked={saveToPhotos} onChange={() => setSaveToPhotos((v) => !v)}
            className="mt-0.5 h-4 w-4 accent-brand" />
          <span className="flex items-center gap-1 text-sm text-secondary">
            {t('acts.receiptSaveToPhotos')}
            <InfoPopover text={t('acts.receiptSaveToPhotosInfo')} />
          </span>
        </label>
        {/* Say it before the pile is uploaded: the act keeps every receipt either way, only the
            convenience copy in «Чеки» is capped, and it fails silently server-side. */}
        {saveToPhotos && galleryRoom != null && galleryRoom < count && (
          <p className="-mt-1 pl-6 text-xs text-warning">
            {t('acts.receiptSaveToPhotosRoom', { room: galleryRoom, count })}
          </p>
        )}

        <Button fullWidth onClick={() => onStart({ withAi: reading, saveToPhotos })}>
          {t('acts.receiptBatchStart', { count })}
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Edit one receipt's text and money. The photo is set once at upload and never replaced — it is the
 * receipt's proof, and swapping it under a row the client may already have seen is not an edit.
 *
 * <p>The reader here is a top-up, not the first read: the receipt was already read once at upload.
 * It fills the three footer fields and nothing else — carrying the paper's positions into the act
 * was removed on 2026-08-28.</p>
 *
 * <p>A receipt still in the outbox is edited here too, with two fields fewer in practice: there is
 * no stored photo to read (so the reader is not offered), and the create endpoint carries no return
 * — a return happens after the shop anyway, by which time the receipt has long landed.</p>
 */
function ReceiptForm({
  actId, editing, pending, busy, onSubmit, onClose, recognize,
}: {
  actId: string;
  editing: WorkActReceiptResponse | null;
  /** Set when this receipt has not synced yet — its photo comes from the queue, not the server. */
  pending: QueuedActReceipt | null;
  busy: boolean;
  onSubmit: (v: ReceiptFormValue) => void;
  onClose: () => void;
  recognize: (receiptId: string) => Promise<ActReceiptRecognizeResponse | null>;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [returned, setReturned] = useState('');
  const [issuedAt, setIssuedAt] = useState('');
  const [reading, setReading] = useState(false);
  const [seededFor, setSeededFor] = useState<string | null>(null);

  const key = editing?.id ?? null;
  if (key !== seededFor) {
    setSeededFor(key);
    setLabel(editing?.label ?? '');
    setAmount(editing == null || editing.amount <= 0 ? '' : String(editing.amount));
    setReturned(editing == null || editing.returnedAmount <= 0 ? '' : String(editing.returnedAmount));
    setIssuedAt(editing?.issuedAt ?? '');
    setReading(false);
  }

  const num = (s: string): number => {
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };
  // Mirrors the server's cap (WORK_ACT_RECEIPT_RETURN_TOO_BIG). Named in place rather than left to
  // a toast after the save: the master is looking at both numbers while he types the wrong one.
  const returnTooBig = num(returned) > num(amount);
  const valid = label.trim() !== '' && num(amount) > 0 && !returnTooBig;
  // Nothing a read could still fill in: every field the footer pass returns is already there.
  // Leaving the button live invites a slow call whose only possible effect is to overwrite what the
  // master just typed off the paper in front of him.
  const nothingToRead = valid && issuedAt.trim() !== '';

  const run = async () => {
    if (!editing) return;
    setReading(true);
    try {
      const read = await recognize(editing.id);
      if (!read?.recognized) {
        toast.info(t('acts.receiptRecognizeFailed'));
        return;
      }
      // A label the master already typed is never overwritten — he named the shop, the reader only
      // guessed it. Neither is the return: it is not on the paper at all.
      if (read.amount != null) setAmount(String(read.amount));
      if (read.issuedAt != null) setIssuedAt(read.issuedAt);
      setLabel((current) => (current.trim() === '' && read.label ? read.label : current));
      if (read.amount == null) toast.info(t('acts.receiptRecognizePartial'));
    } catch (err) {
      toast.error(toAppError(err).message);
    } finally {
      setReading(false);
    }
  };

  return (
    <Modal open={editing !== null} onClose={onClose} title={t('acts.receiptEditTitle')}>
      <div className="space-y-3">
        {/* The paper itself, right above the fields (master feedback): checking a sum that a reader
            guessed means looking at the receipt, and until now the edit dialog covered it up. Tap
            to open it full-size — a folded slip is unreadable at preview height. */}
        {editing?.hasPhoto && (
          <div>
            <ReceiptPhoto variant="preview" title={editing.label}
              source={pending
                ? { kind: 'file', file: pending.file }
                : { kind: 'stored', fileUrl: actsApi.receiptFileUrl(actId, editing.id) }} />
            <p className="mt-1 text-center text-xs text-muted">{t('acts.receiptCheckAgainstPhoto')}</p>
          </div>
        )}
        {pending && (
          <p className="rounded-card border border-warning/40 bg-warning/10 p-2.5 text-xs text-secondary">
            {t('acts.receiptQueuedHint')}
          </p>
        )}

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
        {/* Its own full-width row under the pair, not a third column: on a phone three money boxes
            side by side leave no room for either label. Hidden entirely until the receipt lands —
            the create endpoint has no such field, so a number typed here would go nowhere. */}
        {!pending && (
          <Field label={t('acts.receiptReturned')}>
            <Input inputMode="decimal" value={returned} placeholder="0" onChange={(e) => setReturned(e.target.value)} />
          </Field>
        )}
        {!pending && (returnTooBig ? (
          <p className="-mt-1 text-xs text-danger">{t('acts.receiptReturnedTooBig')}</p>
        ) : (
          <p className="-mt-1 text-xs text-muted">{t('acts.receiptReturnedHint')}</p>
        ))}
        {num(returned) > 0 && !returnTooBig && (
          <div className="flex justify-between rounded-card bg-surface-sunken px-3 py-2 text-sm font-semibold text-primary">
            <span>{t('acts.receiptBilled')}</span>
            <span>{formatMoneyExact(num(amount) - num(returned))}</span>
          </div>
        )}
        {/* Under the fields, not above them (master feedback): the receipt was already read once on
            upload, so here the reader is a top-up for what is still blank — not the first thing the
            master came in for. */}
        {!pending && (
          <div className="border-t border-border pt-3">
            <div className="flex items-center gap-1.5">
              <Button fullWidth variant="secondary" disabled={reading || nothingToRead}
                onClick={() => void run()}>
                ✨ {t('acts.receiptRecognizeOne')}
              </Button>
              <InfoPopover text={t('acts.receiptRecognizeInfo')} />
            </div>
            {nothingToRead && (
              <p className="mt-1.5 text-xs text-muted">{t('acts.receiptNothingToRead')}</p>
            )}
            {reading && (
              <p className="mt-2 flex items-center gap-2 text-sm text-muted">
                <Spinner size="sm" />
                {t('acts.receiptRecognizing')}
              </p>
            )}
          </div>
        )}

        <Button fullWidth loading={busy} disabled={!valid || reading}
          onClick={() => onSubmit({
            label: label.trim(), amount: num(amount), returnedAmount: num(returned),
            issuedAt: issuedAt.trim() === '' ? null : issuedAt,
          })}>
          {t('common.save')}
        </Button>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium text-muted">{label}</span>{children}</label>;
}
