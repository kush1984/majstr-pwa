import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Modal } from '@/components/Modal.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { InfoPopover } from '@/components/InfoPopover.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { QrScanSheet } from '@/components/QrScanSheet.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { actsApi } from '@/api/acts.ts';
import { formatMoneyExact } from '@/lib/format.ts';
import { usePhotoBlobUrl } from '@/features/photos/PhotoView.tsx';
import { UpgradeIntentModal } from '@/features/upgrade/UpgradeIntentModal.tsx';
import { useMe } from '@/features/auth/useMe.ts';
import { upgradeApi } from '@/api/upgrade.ts';
import { useAddActReceipt, useDeleteActReceipt, useUpdateActReceipt } from './useActs.ts';
import type { ActReceiptRecognizeResponse, RecognizedReceiptItem, WorkActReceiptResponse } from '@/api/types.ts';

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
  showPhotosInPdf,
  onShowPhotosInPdfChange,
  onTransferItems,
}: {
  actId: string;
  projectId: string;
  receipts: WorkActReceiptResponse[];
  signed: boolean;
  toExpenses: boolean;
  onToExpensesChange: (v: boolean) => void;
  /** PDF-appendix-only toggle: the portal always shows the photos. */
  showPhotosInPdf: boolean;
  onShowPhotosInPdfChange: (v: boolean) => void;
  /** Recognized positions to carry into the act's additional works (round 2). */
  onTransferItems: (items: RecognizedReceiptItem[]) => void;
}) {
  const { t } = useTranslation();
  const add = useAddActReceipt(actId, projectId);
  const update = useUpdateActReceipt(actId, projectId);
  const remove = useDeleteActReceipt(actId, projectId);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WorkActReceiptResponse | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WorkActReceiptResponse | null>(null);
  const [viewing, setViewing] = useState<WorkActReceiptResponse | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // The gate is per MODE, not per screen (master decision, 2026-08-23): reading the footer —
  // label/date/total — is FREE, carrying the item table into the act is PRO. It is also per
  // SOURCE: everything a fiscal QR hands over is free, positions included, because no model runs
  // on that path — so the tick itself is not what's gated, the photo item-read is.
  const { data: me } = useMe();
  const isPro = (me?.plan ?? 'FREE') !== 'FREE';

  // Itemized receipts are reference-only: their positions already bill the money as act lines.
  const total = receipts.filter((r) => !r.itemized).reduce((sum, r) => sum + r.amount, 0);

  const openAdd = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (r: WorkActReceiptResponse) => { setEditing(r); setFormOpen(true); };

  const onSubmit = async (v: { label: string; amount: number; issuedAt: string | null; file: File | null;
                               items: RecognizedReceiptItem[] | null; saveToPhotos: boolean }) => {
    try {
      if (editing) {
        await update.mutateAsync({
          receiptId: editing.id,
          req: { label: v.label, amount: v.amount, issuedAt: v.issuedAt },
        });
      } else {
        if (!v.file) return; // the form disables submit without a photo; belt-and-braces
        await add.mutateAsync({
          label: v.label, amount: v.amount, issuedAt: v.issuedAt, file: v.file,
          itemized: v.items != null,
          saveToPhotos: v.saveToPhotos,
        });
        if (v.items != null) {
          // Into the editor's «Додаткові роботи» rows — where the master reviews and fixes what
          // the model could not read (the same «перепитування» the estimate import does).
          onTransferItems(v.items);
        }
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
                  {/* Kopecks as typed (master feedback) — money display must not round. An itemized
                      receipt's amount is muted reference: its positions bill it in the act. */}
                  <span className={'whitespace-nowrap text-sm font-semibold '
                    + (r.itemized ? 'text-muted' : 'text-primary')}>{formatMoneyExact(r.amount)}</span>
                </div>
                {r.itemized && (
                  <p className="mt-0.5 text-xs text-muted">{t('acts.receiptItemizedBadge')}</p>
                )}
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
          <span>{t('acts.receiptsTotal')}</span><span>{formatMoneyExact(total)}</span>
        </div>
      )}

      {!signed && (
        <>
          <button type="button" onClick={openAdd} className="mt-2 text-sm font-semibold text-brand">
            {t('acts.addReceipt')}
          </button>
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

      <ReceiptForm
        open={formOpen}
        editing={editing}
        busy={add.isPending || update.isPending}
        onSubmit={onSubmit}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        recognize={(file, withItems) => actsApi.recognizeReceipt(actId, file, withItems)}
        readQr={(payload, withItems) => actsApi.readReceiptQr(actId, payload, withItems)}
        itemsAllowed={isPro}
        onItemsBlocked={() => { void upgradeApi.click('RECEIPT_IMPORT'); setUpgradeOpen(true); }}
      />

      <UpgradeIntentModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />

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

/**
 * Add / edit one receipt. The photo is MANDATORY on add (round 2 — it is the receipt's proof) and
 * set once; editing touches only the text. Two pick paths on a phone: the camera straight at the
 * paper, or the gallery — a receipt often already lives there as a photo.
 *
 * <p>Picking a photo triggers recognition: date + total prefill from the model (a small one), and
 * with «перенести позиції» ticked — the full item read. recognized=false just leaves the fields
 * manual; nothing blocks on the model.</p>
 *
 * <p>«Зчитати QR» is a third path to the same fields, not a replacement: the fiscal code printed on
 * the receipt carries the total and the date outright, and the tax service can hand back the
 * positions — no model, no cost, so no gate. It fills data, never paper: the photo stays mandatory,
 * because the receipt's proof is the photograph of it.</p>
 */
function ReceiptForm({
  open, editing, busy, onSubmit, onClose, recognize, readQr, itemsAllowed, onItemsBlocked,
}: {
  open: boolean;
  editing: WorkActReceiptResponse | null;
  busy: boolean;
  onSubmit: (v: { label: string; amount: number; issuedAt: string | null; file: File | null;
                  items: RecognizedReceiptItem[] | null; saveToPhotos: boolean }) => void;
  onClose: () => void;
  recognize: (file: File, withItems: boolean) => Promise<ActReceiptRecognizeResponse>;
  /** Same answer shape as recognize, taken from the fiscal QR instead of the paper. */
  readQr: (payload: string, withItems: boolean) => Promise<ActReceiptRecognizeResponse>;
  /** The item-table read off a PHOTO is PRO; the footer read and the whole QR path are not. */
  itemsAllowed: boolean;
  onItemsBlocked: () => void;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [issuedAt, setIssuedAt] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [withItems, setWithItems] = useState(false);
  // Also file the photo into the object's Фото tab («Чеки» folder) — default OFF (master decision).
  const [saveToPhotos, setSaveToPhotos] = useState(false);
  const [items, setItems] = useState<RecognizedReceiptItem[] | null>(null);
  // Which read is in flight, not just "a read is": the footer pass answers in seconds, the full
  // item table takes tens of them, and a silent spinner that long reads as a hung screen.
  const [recognizing, setRecognizing] = useState<null | 'meta' | 'items' | 'qr'>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  // Seed once per opening: an «edit» carries the receipt's values, an «add» starts blank. Keyed on
  // the receipt id (or '' for a new one) so reopening the same dialog reseeds.
  const key = open ? (editing?.id ?? '') : null;
  if (key !== seededFor) {
    setSeededFor(key);
    setLabel(editing?.label ?? '');
    setAmount(editing == null ? '' : String(editing.amount));
    setIssuedAt(editing?.issuedAt ?? '');
    setFile(null);
    setWithItems(false);
    setSaveToPhotos(false);
    setItems(null);
    setRecognizing(null);
    setQrOpen(false);
  }

  const num = (s: string): number => {
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };
  // The photo is mandatory on add; an edit never changes it.
  const valid = label.trim() !== '' && num(amount) > 0 && (editing != null || file != null);

  /** Both readers answer the same shape, so they fill the form the same way. A label the master
   *  already typed is never overwritten — he named the shop, the reader only guessed it. */
  const prefill = (read: ActReceiptRecognizeResponse, gotItems: boolean) => {
    if (read.amount != null) setAmount(String(read.amount));
    if (read.issuedAt != null) setIssuedAt(read.issuedAt);
    setLabel((current) => current.trim() === '' && read.label ? read.label : current);
    setItems(gotItems ? read.items : null);
  };

  /** One recognition per picked file (re-run when «перенести позиції» flips ON with a file already
   *  picked, to fetch the items). Prefills what the model read; failure = stay manual. */
  const runRecognition = async (picked: File, wantItems: boolean) => {
    // The gate sits HERE, on the paid action, and not on the tick: reading an item table off a
    // PHOTO is the model call PRO pays for, while the same positions off a fiscal QR cost nothing.
    // Gating the tick — as this did before the QR path existed — would have left FREE unable to
    // ask for the free positions at all.
    const wanted = wantItems && itemsAllowed;
    if (wantItems && !itemsAllowed) onItemsBlocked();
    setRecognizing(wanted ? 'items' : 'meta');
    try {
      const read = await recognize(picked, wanted);
      if (!read.recognized) {
        setItems(null);
        toast.info(t('acts.receiptRecognizeFailed'));
        return;
      }
      prefill(read, wanted);
      if ((read.amount == null || (wanted && read.items.length === 0))) {
        toast.info(t('acts.receiptRecognizePartial'));
      }
    } catch (err) {
      setItems(null);
      toast.error(toAppError(err).message);
    } finally {
      setRecognizing(null);
    }
  };

  /** The QR the master just aimed at → the same prefill, straight from the fiscal record. */
  const onQrScanned = async (payload: string) => {
    setQrOpen(false);
    setRecognizing('qr');
    try {
      const read = await readQr(payload, withItems);
      if (!read.recognized) {
        setItems(null);
        toast.info(t('acts.receiptRecognizeFailed'));
        return;
      }
      prefill(read, withItems);
      // A QR always carries the money, so an empty item list is the only partial worth naming —
      // and it is a fact about that receipt, not a failure to retry.
      if (withItems && read.items.length === 0) toast.info(t('acts.receiptQrNoItems'));
    } catch (err) {
      setItems(null);
      toast.error(toAppError(err).message);
    } finally {
      setRecognizing(null);
    }
  };

  const onPick = (picked: File | null) => {
    setFile(picked);
    setItems(null);
    if (picked) void runRecognition(picked, withItems);
  };

  const onWithItemsToggle = () => {
    const next = !withItems;
    setWithItems(next);
    if (next && file) void runRecognition(file, true);
    if (!next) setItems(null);
  };

  return (
    <Modal open={open} onClose={onClose} title={t(editing ? 'acts.receiptEditTitle' : 'acts.receiptAddTitle')}>
      <div className="space-y-3">
        {!editing && (
          <Field label={t('acts.receiptPhoto')}>
            {/* Two pick paths (master feedback): the camera AND the gallery — capture="environment"
                alone locked phones out of receipts already photographed. */}
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
            <input ref={galleryRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => cameraRef.current?.click()}>
                📷 {t('acts.receiptTakePhoto')}
              </Button>
              <Button variant="secondary" onClick={() => galleryRef.current?.click()}>
                🖼 {t('acts.receiptPickFile')}
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-muted">
              {file ? file.name : t('acts.receiptPhotoRequired')}
            </p>
          </Field>
        )}
        {!editing && (
          // Its own full-width row rather than a third chip beside the two above: at 375px three
          // buttons in a line shrink past a comfortable tap target, and this one is not a way to
          // attach paper — it fills the fields, the photo is still required.
          <div className="flex items-center gap-1.5">
            <Button fullWidth variant="secondary" disabled={recognizing != null}
              onClick={() => setQrOpen(true)}>
              🔳 {t('acts.receiptScanQr')}
            </Button>
            <InfoPopover text={t('acts.receiptQrInfo')} />
          </div>
        )}
        {recognizing != null && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Spinner size="sm" /> {t(recognizing === 'qr' ? 'acts.receiptQrReading'
              : recognizing === 'items' ? 'acts.receiptRecognizingItems' : 'acts.receiptRecognizing')}
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
        {!editing && (
          <>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={withItems} onChange={onWithItemsToggle}
                className="mt-0.5 h-4 w-4 accent-brand" />
              <span className="flex flex-wrap items-center gap-1 text-sm text-secondary">
                {t('acts.receiptRecognizeItems')}
                {!itemsAllowed && (
                  <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
                    {t('landing.proBadge')}
                  </span>
                )}
                <InfoPopover text={t('acts.receiptRecognizeItemsInfo')} />
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={saveToPhotos} onChange={() => setSaveToPhotos((v) => !v)}
                className="mt-0.5 h-4 w-4 accent-brand" />
              <span className="flex items-center gap-1 text-sm text-secondary">
                {t('acts.receiptSaveToPhotos')}
                <InfoPopover text={t('acts.receiptSaveToPhotosInfo')} />
              </span>
            </label>
          </>
        )}
        {withItems && items != null && items.length > 0 && (
          <p className="rounded-lg bg-surface-sunken p-2 text-xs text-secondary">
            {t('acts.receiptItemsFound', { count: items.length })}
          </p>
        )}
        <Button fullWidth loading={busy} disabled={!valid || recognizing != null}
          onClick={() => onSubmit({
            label: label.trim(), amount: num(amount),
            issuedAt: issuedAt.trim() === '' ? null : issuedAt,
            file,
            items: withItems && items != null && items.length > 0 ? items : null,
            saveToPhotos,
          })}>
          {t(editing ? 'common.save' : 'acts.receiptAdd')}
        </Button>
      </div>

      <QrScanSheet open={qrOpen} onClose={() => setQrOpen(false)} onScanned={(p) => void onQrScanned(p)} />
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
