import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/Badge.tsx';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Modal } from '@/components/Modal.tsx';
import { InfoPopover } from '@/components/InfoPopover.tsx';
import { Fab, FabAction } from '@/components/Fab.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { ErrorState } from '@/components/ErrorState.tsx';
import { estimatesApi } from '@/api/estimates.ts';
import { openPdfTab } from '@/lib/openPdfTab.ts';
import { toast } from '@/hooks/useToast.ts';
import { bodyScrollLocked, scrollRowIntoView } from '@/lib/scrollRowIntoView.ts';
import { toAppError } from '@/api/errors.ts';
import { formatMoney, formatNumber, initials } from '@/lib/format.ts';
import { ESTIMATE_STATUS_VARIANT } from '@/lib/labels.ts';
import { routes } from '@/lib/config.ts';
import type { EstimateItemResponse, EstimateResponse, ProjectResponse } from '@/api/types.ts';
import { TradeSelect, type TradeChoice } from './TradeSelect.tsx';
import { useProject } from '@/features/projects/useProjects.ts';
import { EmailVerifyModal } from '@/features/email/EmailVerifyModal.tsx';
import { ItemForm } from './ItemForm.tsx';
import { EstimateItemsBoard } from './EstimateItemsBoard.tsx';
import { EstimateReceipts } from './EstimateReceipts.tsx';
import { AddItemSheet } from './AddItemSheet.tsx';
import { SharePortalSheet } from '@/features/projects/SharePortalSheet.tsx';
import { ReceiptImportSheet } from './ReceiptImportSheet.tsx';
import { useOnlineGuard } from '@/hooks/useOnlineGuard.ts';
import { useMe } from '@/features/auth/useMe.ts';
import { useEmailGate } from '@/features/email/useEmailGate.ts';
import { estimateName } from './estimateName.ts';
import {
  useEstimate,
  useRemoveItem,
  useDeleteItems,
  useDuplicateEstimate,
  useUpdateItem,
  useUpdateEstimate,
  useReopenEstimate,
  useDeleteEstimate,
  useInvalidateEstimate,
  useReorderItems,
} from './useEstimate.ts';
import { useSaveAsTemplate } from './useEstimateTemplates.ts';
import { usePhotos } from '@/features/photos/usePhotos.ts';
import { ReceiptPdfSheet } from './ReceiptPdfSheet.tsx';

// Reopen (SIGNED → DRAFT) is deliberately hidden from the UI for now (payments-economy-portal
// iteration) — the backend endpoint and this component's own handler/dialog stay fully wired so
// re-enabling later is a one-line flip, same pattern as ELECTRICAL_MEASUREMENTS_ENABLED. See the
// sibling flip in ProjectDetailPage.tsx's row-level menu.
const REOPEN_ENABLED: boolean = false;

/** Where «← назад» (and a post-delete redirect) should land — the object page, on the SAME tab
 *  the master opened this estimate from (`fromTab`, off this page's own `?from=` param), or the
 *  default Кошторис tab when absent. Pulled out of the component for a test that doesn't need to
 *  mount the whole page (economy-nav-and-discount iteration). */
export function resolveBackUrl(projectId: string, fromTab: string | null): string {
  if (!projectId) return routes.projects;
  return `${routes.project(projectId)}${fromTab ? `?tab=${fromTab}` : ''}`;
}

export function EstimateEditorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  // Which object tab to return to (economy-nav-and-discount iteration) — `?from=economy` when opened
  // from the Економіка tab's signed-estimate panel, absent (→ default Кошторис tab) everywhere else,
  // including direct entry. (Legacy `?from=act` still resolves via resolveTab's alias.) Read once at
  // mount: navigating away and back re-mounts this page with a fresh `id`/URL anyway.
  const [searchParams] = useSearchParams();
  const fromTab = searchParams.get('from');
  const { t } = useTranslation();
  const estimate = useEstimate(id);
  const projectId = estimate.data?.projectId ?? '';
  const project = useProject(projectId);
  const photos = usePhotos(projectId);
  const updateItem = useUpdateItem(id);
  const removeItem = useRemoveItem(id);
  const updateEstimate = useUpdateEstimate(id);
  const reopenEstimate = useReopenEstimate(id);
  const deleteEstimate = useDeleteEstimate(id);
  const reorder = useReorderItems(id);
  const invalidate = useInvalidateEstimate(id);

  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<EstimateItemResponse | null>(null);
  // Positions added/edited while the master is on THIS estimate get a faint highlight, so a change
  // doesn't get lost in a long list (especially after an edit on iOS). Session-scoped: cleared when the
  // estimate id changes below, and gone entirely on navigating away (it's local state).
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  // Just the ids from the MOST RECENT edit/add, shown a step brighter than the rest of `touched` —
  // going down a long list, the master can see at a glance which line he last worked on, distinct
  // from everything he already touched earlier in the same pass.
  const [lastTouched, setLastTouched] = useState<ReadonlySet<string>>(() => new Set());
  // A new position lands where its category sorts it, not at the bottom — on a long estimate that is
  // off-screen, and the master had to scroll hunting for the green row (his words: «треба прокручувати
  // і шукати де та позиція додалась»). The highlight is only useful if you can see it.
  const scrollTo = useRef<string | null>(null);
  const markTouched = (ids: string[]) => {
    setTouched((prev) => {
      const next = new Set(prev);
      ids.forEach((tid) => next.add(tid));
      return next;
    });
    setLastTouched(new Set(ids));
    scrollTo.current = ids[0] ?? null;
  };
  const [deletingItem, setDeletingItem] = useState<EstimateItemResponse | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [emailGateOpen, setEmailGateOpen] = useState(false);
  const ensureEmailVerified = useEmailGate();
  const [editOpen, setEditOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [reopenConfirmOpen, setReopenConfirmOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateTradeChoice, setTemplateTradeChoice] = useState<TradeChoice>({ trade: null, customTradeId: null });
  const saveAsTemplate = useSaveAsTemplate(id);
  // Bulk selection: picking lines to delete, or to mark up in a copy. `null` = off, which is what
  // keeps the ordinary board's tap meaning exactly one thing.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [markupOpen, setMarkupOpen] = useState(false);
  const deleteItems = useDeleteItems(id);
  const duplicate = useDuplicateEstimate(id);

  const [receiptOpen, setReceiptOpen] = useState(false);
  const [pdfSheetOpen, setPdfSheetOpen] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const { data: me } = useMe(); // for the custom trades on «зберегти як шаблон»
  // Actions that genuinely need the server (PDF, sharing, LLM recognition) say so when offline.
  const { guard } = useOnlineGuard();

  // The route component is reused across estimates, so drop the highlight set when the id changes —
  // yesterday's edits must not glow on a different sheet.
  useEffect(() => { setTouched(new Set()); setLastTouched(new Set()); scrollTo.current = null; }, [id]);

  // Runs on BOTH the mark and the refetch, because their order is not fixed: an offline add is in the
  // cache before `markTouched`, an online one lands after it. Whichever renders the row last finds it
  // here; the target is cleared only once it actually exists, so the scroll is never silently dropped.
  // It also re-runs when the add sheet / edit modal closes: while one is open the page is frozen
  // (`bodyScrollLocked`) and nothing can scroll — and the manual add deliberately keeps the sheet open
  // to offer «зберегти в каталог», which is exactly the case the master reported as working from the
  // catalog but not by hand. Burning the target there would drop the scroll for good.
  useEffect(() => {
    const target = scrollTo.current;
    if (!target || bodyScrollLocked()) return;
    const row = document.querySelector(`[data-item-id="${target}"]`);
    if (!row) return;
    scrollTo.current = null;
    scrollRowIntoView(row);
  }, [lastTouched, estimate.data, addOpen, editing]);

  if (estimate.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas text-brand">
        <Spinner size="lg" />
      </div>
    );
  }

  // Only DATA decides whether we can render. Offline the background refetch fails and leaves an
  // error ON the query while the cached estimate is still right there — branching on `isError`
  // first threw that data away, so the second visit to a screen with no signal showed
  // "не знайдено" instead of the estimate the master had just been reading.
  if (!estimate.data) {
    // Transient failure (offline / backend down / 5xx) is NOT "не знайдено" —
    // offer a retry instead of suggesting the estimate doesn't exist.
    const status = estimate.error ? toAppError(estimate.error).status : 404;
    if (estimate.isError && status !== 404 && status !== 403) {
      return (
        <div className="flex min-h-dvh items-center justify-center bg-canvas">
          <ErrorState
            error={estimate.error}
            what={t('offline.dataEstimate')}
            onRetry={() => void estimate.refetch()}
          />
        </div>
      );
    }
    return (
      <div className="min-h-dvh bg-canvas">
        <EmptyState
          icon="⚠️"
          title={t('estimate.notFoundTitle')}
          text={t('estimate.notFoundText')}
          action={<Button onClick={() => navigate(routes.projects)}>{t('estimate.toObjects')}</Button>}
        />
      </div>
    );
  }

  const est = estimate.data;
  const nextSortOrder = est.items.length;
  // A signed estimate is read-only in the UI (the backend also enforces 409):
  // hide edit/delete, show a "view only" banner with a master-only reopen.
  const signed = est.status === 'SIGNED';
  // Receipts offered (default-on) for embedding in the PDF: this estimate's own, plus — for a
  // consolidated estimate — those of its source estimates (their receipts stay on the sources).
  // The object's progress photos are offered too (default-off) for a receipt saved as a plain photo.
  const receiptEstimateIds = new Set([id, ...(est.sourceEstimateIds ?? [])]);
  const receipts = (photos.data ?? []).filter(
    (p) => p.source === 'RECEIPT' && p.estimateId != null && receiptEstimateIds.has(p.estimateId),
  );
  const otherPhotos = (photos.data ?? []).filter((p) => p.source === 'MANUAL');

  // Returns to the SAME object tab the master opened this estimate from (economy-nav-and-discount
  // iteration) — `fromTab` came in on this page's own URL, so this works identically whether the
  // master uses this in-app button or the browser's own back (which restores that URL directly).
  const backUrl = resolveBackUrl(projectId, fromTab);
  const goBack = () => navigate(backUrl);

  // The actual download, given the receipts the master chose to attach ([] = none). Shared by the
  // direct path (no receipts) and the picker sheet.
  const runPdf = async (receiptIds: string[]) => {
    setPdfLoading(true);
    try {
      // Reserved-tab helper (openPdfTab) — window.open() after the awaited fetch silently fails on
      // iOS Safari; the helper reserves the tab synchronously and fills it once the blob is ready.
      await openPdfTab(() => estimatesApi.fetchPdf(id, receiptIds));
      setPdfSheetOpen(false);
    } catch (err) {
      const failure = toAppError(err);
      if (failure.code === 'EMAIL_NOT_VERIFIED') {
        setEmailGateOpen(true);
      } else if (failure.code === 'NETWORK') {
        // The request never left the phone — signal dropped after the guard let it through. Say
        // that, because «Не вдалося сформувати PDF» reads as a fault in the estimate or the server.
        toast.error(failure.message);
      } else {
        toast.error(t('estimate.pdfFailed'));
      }
    } finally {
      setPdfLoading(false);
    }
  };

  const onPdf = async () => {
    // The PDF is a client-facing deliverable and now requires a verified email
    // (anti-abuse). Bounce an unverified master straight to the verify modal
    // instead of firing a doomed request — but ask the server first, because a
    // cached `false` outlives a verification done in the mail app's browser.
    if (!(await ensureEmailVerified())) {
      setEmailGateOpen(true);
      return;
    }
    // Any photos to offer (linked receipts or object photos) → ask which to attach; else download straight.
    if (receipts.length > 0 || otherPhotos.length > 0) {
      setPdfSheetOpen(true);
      return;
    }
    await runPdf([]);
  };

  const onShare = async () => {
    // Sharing reaches a client and requires a verified email — check upfront so an
    // unverified master gets the verify prompt immediately, not a share dialog that
    // dead-ends on every option. Confirmed against the server, see useEmailGate.
    if (!(await ensureEmailVerified())) {
      setEmailGateOpen(true);
      return;
    }
    setShareOpen(true);
  };

  const openEdit = () => {
    setRenameValue(est.name ?? '');
    setEditOpen(true);
  };

  const saveName = async () => {
    try {
      await updateEstimate.mutateAsync({
        status: est.status,
        validUntil: est.validUntil ?? undefined,
        notes: est.notes ?? undefined,
        name: renameValue.trim() || undefined,
      });
      toast.success(t('estimate.saved'));
      setEditOpen(false);
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  // Saving as a template reads the estimate's items on the server — online-only.
  const openSaveTemplate = guard(() => {
    setTemplateName(est.name ?? '');
    setTemplateTradeChoice({ trade: null, customTradeId: null });
    setSaveTemplateOpen(true);
  });

  const saveTemplate = async () => {
    if (!templateName.trim()) return;
    try {
      await saveAsTemplate.mutateAsync({
        name: templateName.trim(),
        trade: templateTradeChoice.trade,
        customTradeId: templateTradeChoice.customTradeId,
      });
      toast.success(t('templates.saved'));
      setSaveTemplateOpen(false);
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  const confirmDeleteItem = async () => {
    if (!deletingItem) return;
    try {
      await removeItem.mutateAsync(deletingItem.id);
      toast.success(t('estimate.deleted'));
      setEditing(null); // close the edit form only after a successful delete
    } catch (err) {
      toast.error(toAppError(err).message);
    } finally {
      setDeletingItem(null);
    }
  };

  const confirmDelete = async () => {
    try {
      await deleteEstimate.mutateAsync();
      toast.success(t('estimate.estimateDeleted'));
      void navigate(backUrl, { replace: true });
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  const confirmReopen = async () => {
    try {
      await reopenEstimate.mutateAsync();
      toast.success(t('estimate.reopened'));
      setReopenConfirmOpen(false);
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };


  return (
    <div className="min-h-dvh bg-canvas">
      <div className="mx-auto max-w-app px-4 pb-44 pt-4 sm:px-6 lg:px-8 lg:pb-10">
        {/* Header */}
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={goBack}
            aria-label={t('common.back')}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-lg text-primary"
          >
            ←
          </button>
          <div className="min-w-0 flex-1">
            {/* Wraps rather than truncates: a master names variants to tell them apart («Зведений
                кошторис +15%»), and the part that distinguishes them is at the END, which is
                exactly what an ellipsis eats on a phone. */}
            <div className="break-words text-[17px] font-bold leading-tight text-primary">
              {estimateName(est.name, est.createdAt)}
            </div>
            <div className="truncate text-xs text-muted">
              {project.data ? project.data.name : t('estimate.autosaved')}
            </div>
          </div>
          <Badge variant={ESTIMATE_STATUS_VARIANT[est.status]}>
            {t('status.estimate.' + est.status)}
          </Badge>
          {!signed && (
            <button
              type="button"
              onClick={openEdit}
              aria-label={t('estimate.edit')}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-base leading-none text-primary"
            >
              ✏️
            </button>
          )}
        </div>

        {signed && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-card border border-border bg-brand-soft px-3.5 py-3">
            <span className="flex flex-1 items-center gap-1 text-sm font-semibold text-primary">
              {t('estimate.signedViewOnly')}
              <InfoPopover text={t('estimate.signedViewOnlyInfo')} label={t('estimate.signedViewOnly')} />
            </span>
            {REOPEN_ENABLED && (
              <Button variant="secondary" onClick={() => setReopenConfirmOpen(true)}>
                {t('estimate.reopen')}
              </Button>
            )}
          </div>
        )}

        {/* Client banner */}
        {project.data && <ClientBanner project={project.data} />}

        {/* Items + summary (two columns on desktop) */}
        <div className="lg:grid lg:grid-cols-[1.7fr_1fr] lg:items-start lg:gap-5">
          <div>
            {est.items.length === 0 ? (
              <EmptyState
                icon="🧾"
                title={t('estimate.emptyTitle')}
                text={t('estimate.emptyText')}
                action={
                  <Button onClick={() => setAddOpen(true)} disabled={signed}>
                    {t('estimate.addItem')}
                  </Button>
                }
              />
            ) : (
              <>
                <EstimateItemsBoard
                  items={est.items}
                  signed={signed}
                  touched={touched}
                  lastTouched={lastTouched}
                  onEdit={setEditing}
                  selection={picked === null ? undefined : {
                    selected: picked,
                    onToggle: (itemId) => setPicked((prev) => {
                      const next = new Set(prev);
                      if (!next.delete(itemId)) next.add(itemId);
                      return next;
                    }),
                    onToggleSection: (ids, select) => setPicked((prev) => {
                      const next = new Set(prev);
                      ids.forEach((itemId) => (select ? next.add(itemId) : next.delete(itemId)));
                      return next;
                    }),
                  }}
                  onArrange={(arranged) => {
                    reorder.mutate(arranged, {
                      // The optimistic cache already shows the new arrangement, so a failure has to
                      // put the old one back — otherwise the screen keeps an order the server rejected.
                      onError: (err) => {
                        void invalidate();
                        toast.error(toAppError(err).message);
                      },
                    });
                  }}
                />
                {!signed && (
                  <button
                    type="button"
                    onClick={() => setAddOpen(true)}
                    // ml-8 for the same reason as the selection bar: it belongs to the CARD column,
                    // which starts past the w-7 handle/tick gutter + gap-1 of every item row. The
                    // width has to be spelled out — a <button> shrink-wraps at `width: auto` even
                    // as a block-level flex container, so `w-full` minus the offset it is given.
                    className="mt-1 ml-8 flex w-[calc(100%-2rem)] items-center justify-center gap-2 rounded-xl border border-dashed border-brand py-3 text-sm font-semibold text-brand"
                  >
                    {t('estimate.addItem')}
                  </button>
                )}
                {/*
                  The selection bar lives INSIDE the list column and is sticky, not fixed to the
                  viewport. Fixed meant it could only ever guess its width — first the whole screen,
                  then the page's max width — while the positions it acts on sit in a narrower
                  column beside the client card. Sticky inside the column means it simply IS the
                  width of a position, because it is in the same box as one.

                  The bottom offset clears the fixed mobile nav (~4.2rem + safe area), which is
                  `lg:hidden` — hence the plain `bottom-4` back on desktop.

                  `ml-8` is not a nudge: an item row is `w-7` tick column + `gap-1`, so the CARD
                  starts exactly 2rem in. The bar acts on the cards, so it lines up with them, not
                  with the column they sit in. Keep it in step with ItemRow if that gutter changes.
                */}
                {picked !== null && (
                  <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 ml-8 mt-2 flex items-center gap-3 rounded-2xl bg-ink px-4 py-3 shadow-card-lg lg:bottom-4">
                    <span className="flex-shrink-0 text-sm font-semibold text-white">
                      {t('estimate.selectedCount', { count: picked.size })}
                    </span>
                    {/* The count reports, the buttons act — so they sit at the far edge instead of
                        stretching to fill. Sized to their words; the 44px height is the tap target,
                        which is a floor and not a look. */}
                    <div className="ml-auto flex flex-shrink-0 items-center gap-1">
                      <button
                        type="button"
                        disabled={picked.size === 0}
                        onClick={() => setBulkDeleteOpen(true)}
                        className="min-h-[44px] rounded-xl bg-danger px-5 text-sm font-semibold text-white disabled:bg-white/15 disabled:text-white/40"
                      >
                        {t('common.delete')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPicked(null)}
                        className="min-h-[44px] rounded-xl px-3 text-sm font-semibold text-white/70"
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Receipts attached to this estimate — sits directly under the Materials group (the
                last block above), and shows even for an estimate with no lines (a receipt kept
                without moving its positions in). Renders nothing when there are no receipts. */}
            <EstimateReceipts
              projectId={projectId}
              estimateId={id}
              sourceEstimateIds={est.sourceEstimateIds}
              signed={signed}
            />

            {/* What the applied bundle promised the client (V121) — shown here because this is
                where it is PRINTED: under the table, in the portal and in the PDF. The master
                should not have to open the client's link to find out what his own estimate says.
                Read-only on purpose: it is a snapshot taken when the bundle was applied, so it is
                edited by editing the bundle, and re-wording the bundle never rewrites an estimate
                the client already signed. */}
            {(est.qualityNote?.trim() ?? '') !== '' && (
              <div className="mt-4 rounded-card border border-border bg-surface p-4">
                <h2 className="mb-1 text-sm font-bold text-primary">{t('estimate.qualityNote')}</h2>
                <p className="mb-2 text-[11px] text-muted">{t('estimate.qualityNoteHint')}</p>
                <p className="whitespace-pre-line text-xs leading-snug text-primary">
                  {est.qualityNote?.trim()}
                </p>
              </div>
            )}
          </div>

          {/* Desktop summary */}
          <div className="hidden lg:sticky lg:top-8 lg:block">
            <SummaryCard est={est} project={project.data} />
          </div>
        </div>
      </div>

      {/* Mobile summary — a peek bar that taps / swipes up to ~a third of the screen so the totals
          stop eating the list. Hidden while selecting (the selection bar owns the bottom then). The
          FAB floats above it (z-50) in the sheet's reserved bottom dock, so it never covers a number
          and never jumps up with the sheet. */}
      {picked === null && <MobileSummarySheet est={est} />}

      {/* Floating actions (speed-dial) — always in reach on every screen size */}
      <Fab ariaLabel={t('estimate.actionsMenu')}>
        {(close) => (
          <>
            {!signed && (
              <FabAction icon="＋" label={t('estimate.addItemTitle')} onClick={() => close(() => setAddOpen(true))} />
            )}
            {/* Entering selection from the FAB, not from a long press: the rows already carry drag
                handles, and on Android a long press competes with text selection and the context
                menu. A named action is also the only version a master can discover. */}
            {!signed && est.items.length > 0 && (
              <FabAction
                icon="☑"
                label={t('estimate.selectItems')}
                onClick={() => close(() => setPicked(new Set()))}
              />
            )}
            {/* Its own action, not a button inside the selection bar. Duplicating is a whole-sheet
                decision — «зроби мені клієнтський варіант +15 %» — and it defaults to every WORK
                line, so making the master first enter a picking mode was a step that bought
                nothing. He adjusts individual prices in the copy afterwards if he wants to. */}
            {est.items.length > 0 && (
              <FabAction
                icon="📄"
                label={t('estimate.duplicateWithMarkup')}
                onClick={() => close(() => setMarkupOpen(true))}
              />
            )}
            {!signed && (
              <FabAction
                icon="🧾"
                label={t('receipt.fabLabel')}
                // Open for everyone since the fiscal-QR iteration: the sheet's QR route is free,
                // and the PRO gate moved inside onto the photo routes. Sending FREE to the upsell
                // from here would hide a free capability behind a paywall.
                onClick={() => close(guard(() => setReceiptOpen(true)))} // server-side either way
              />
            )}
            {/* Online-only: both reach the server (a rendered PDF / a link sent to a client). */}
            <FabAction icon="📤" label={t('estimate.shareWithClientBtn')} onClick={() => close(guard(() => void onShare()))} />
            <FabAction icon="📄" label={t('estimate.generatePdf')} onClick={() => close(guard(() => void onPdf()))} />
            {est.items.length > 0 && (
              <FabAction icon="📋" label={t('templates.saveAsTemplate')} onClick={() => close(openSaveTemplate)} />
            )}
          </>
        )}
      </Fab>

      <EmailVerifyModal open={emailGateOpen} onClose={() => setEmailGateOpen(false)} />
      {pdfSheetOpen && (
        <ReceiptPdfSheet
          receipts={receipts}
          otherPhotos={otherPhotos}
          downloading={pdfLoading}
          onConfirm={runPdf}
          onClose={() => setPdfSheetOpen(false)}
        />
      )}
      {project.data && (
        <SharePortalSheet
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          project={project.data}
          singleEstimateId={id}
          onNeedEmailVerify={() => setEmailGateOpen(true)}
        />
      )}

      <AddItemSheet
        estimateId={id}
        objectId={signed ? undefined : projectId}
        // The other lines and the current total: a «%» line needs something to be a
        // percentage OF, and the live figure under the picker is what makes it checkable.
        siblings={est.items}
        nextSortOrder={nextSortOrder}
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={markTouched}
      />

      {projectId && (
        <ReceiptImportSheet
          open={receiptOpen}
          onClose={() => setReceiptOpen(false)}
          estimateId={id}
          projectId={projectId}
        />
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={t('estimate.editItem')}>
        {editing && (
          <ItemForm
            key={editing.id}
            initial={editing}
            objectId={signed ? undefined : projectId}
            siblings={est.items}
            submitLabel={t('common.save')}
            submitting={updateItem.isPending}
            deleting={removeItem.isPending}
            onSubmit={async (req) => {
              try {
                await updateItem.mutateAsync({ itemId: editing.id, req });
                markTouched([editing.id]);
                toast.success(t('estimate.saved'));
                setEditing(null);
              } catch (err) {
                toast.error(toAppError(err).message);
              }
            }}
            onDelete={() => {
              // Ask before deleting, but KEEP the edit form open (the confirm
              // stacks on top): Cancel returns to it with the user's changes
              // intact; only a confirmed delete closes it.
              setDeletingItem(editing);
            }}
          />
        )}
      </Modal>

      {/* Edit estimate (pencil) — rename + delete only. */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={t('estimate.editTitle')}>
        <label htmlFor="est-name" className="mb-1.5 block text-[13px] font-semibold text-muted">
          {t('estimate.nameLabel')}
        </label>
        <Input
          id="est-name"
          value={renameValue}
          maxLength={255}
          placeholder={t('estimate.namePlaceholder')}
          onChange={(e) => setRenameValue(e.target.value)}
        />
        <Button fullWidth loading={updateEstimate.isPending} onClick={saveName} className="mt-3">
          {t('common.save')}
        </Button>
        <button
          type="button"
          onClick={() => {
            setEditOpen(false);
            setDeleteConfirmOpen(true);
          }}
          className="mt-4 w-full rounded-lg border border-danger/40 py-2.5 text-sm font-semibold text-danger"
        >
          {t('estimate.deleteEstimate')}
        </button>
      </Modal>

      <Modal
        open={saveTemplateOpen}
        onClose={() => setSaveTemplateOpen(false)}
        title={t('templates.saveAsTemplate')}
      >
        <p className="mb-3 text-sm text-muted">{t('templates.saveAsTemplatePrompt')}</p>
        <Input
          value={templateName}
          maxLength={255}
          placeholder={t('templates.namePlaceholder')}
          onChange={(e) => setTemplateName(e.target.value)}
          className="mb-3"
        />
        <div className="mb-4">
          <TradeSelect
            value={templateTradeChoice}
            onChange={setTemplateTradeChoice}
            label={t('templates.tradeLabel')}
            customTrades={me?.customTrades ?? []}
          />
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" fullWidth onClick={() => setSaveTemplateOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button fullWidth loading={saveAsTemplate.isPending} onClick={saveTemplate}>
            {t('common.save')}
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteConfirmOpen}
        title={t('estimate.deleteEstimate')}
        message={t('estimate.deleteConfirm')}
        confirmLabel={t('common.delete')}
        loading={deleteEstimate.isPending}
        onConfirm={confirmDelete}
        onClose={() => setDeleteConfirmOpen(false)}
      />

      <ConfirmDialog
        open={reopenConfirmOpen}
        title={t('estimate.reopen')}
        message={t('estimate.reopenConfirm')}
        confirmLabel={t('estimate.reopen')}
        loading={reopenEstimate.isPending}
        onConfirm={confirmReopen}
        onClose={() => setReopenConfirmOpen(false)}
      />

      <ConfirmDialog
        open={deletingItem !== null}
        title={t('estimate.deleteItemTitle')}
        message={t('estimate.deleteItemConfirm', { name: deletingItem?.name ?? '' })}
        confirmLabel={t('common.delete')}
        loading={removeItem.isPending}
        onConfirm={confirmDeleteItem}
        onClose={() => setDeletingItem(null)}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        title={t('estimate.deleteSelectedTitle')}
        // The COUNT, not a list of names: at thirty-plus lines a list is unreadable, and the number
        // is the thing worth checking before an irreversible tap.
        message={t('estimate.deleteSelectedConfirm', { count: picked?.size ?? 0 })}
        confirmLabel={t('common.delete')}
        loading={deleteItems.isPending}
        onConfirm={() => {
          const ids = [...(picked ?? [])];
          setBulkDeleteOpen(false);
          deleteItems.mutate(ids, {
            onSuccess: () => {
              setPicked(null);
              toast.success(t('estimate.deletedCount', { count: ids.length }));
            },
            onError: (err) => toast.error(toAppError(err).message),
          });
        }}
        onClose={() => setBulkDeleteOpen(false)}
      />

      <MarkupSheet
        open={markupOpen}
        count={est.items.filter((i) => i.type === 'WORK').length}
        loading={duplicate.isPending}
        onClose={() => setMarkupOpen(false)}
        onConfirm={(percent, discount) => {
          duplicate.mutate(
            // The name is composed HERE, not on the server, because «Кошторис від 10 липня» is a
            // display fallback the client invents for an estimate whose stored name is null. The
            // server sees that null and could only ever produce a bare «Кошторис +15%» — a copy
            // whose name has nothing to do with the sheet it came from.
            //
            // No itemIds: the server reads that as every WORK line and leaves materials at cost,
            // which is the foreman's normal case. Materials are bought at their price and passed
            // through — re-pricing them by default would move a client's estimate unasked.
            {
              markupPercent: percent,
              discount,
              name: `${estimateName(est.name, est.createdAt)} ${discount ? '-' : '+'}${percent}%`,
            },
            {
              onSuccess: (created) => {
                setMarkupOpen(false);
                // The copy lands in the Кошториси tab, a screen the master isn't looking at (they
                // duplicated while viewing the source). Don't yank them there — tell them where it
                // went and offer a one-tap jump. Leaving them put is the golden rule: the decision
                // to switch context is the master's, not ours.
                toast.success(
                  t('estimate.duplicatedToEstimatesTab', {
                    name: estimateName(created.name, created.createdAt),
                  }),
                  { action: { label: t('common.open'), onClick: () => void navigate(routes.estimate(created.id)) } },
                );
              },
              onError: (err) => toast.error(toAppError(err).message),
            },
          );
        }}
      />
    </div>
  );
}

/**
 * How much to add, and what it does to this estimate's works total.
 *
 * The preview is the point: a foreman is deciding a margin, and «+15 %» means nothing next to
 * «2 430 ₴ → 2 795 ₴». Online only — see {@link useDuplicateEstimate} for why composing a copy
 * offline would silently misreport the earnings.
 */
function MarkupSheet({
  open, count, loading, onClose, onConfirm,
}: {
  open: boolean;
  count: number;
  loading: boolean;
  onClose: () => void;
  onConfirm: (percent: number, discount: boolean) => void;
}) {
  const { t } = useTranslation();
  const { online, offlineTitle } = useOnlineGuard();
  // Націнка (up) or Уцінка (down) — the same copy, only the sign of the change differs.
  const [discount, setDiscount] = useState(false);
  const [value, setValue] = useState('15');
  const percent = Number(value.replace(',', '.'));
  // A discount cannot exceed 100 % (it would drive prices to zero or below); a markup is open-ended.
  const max = discount ? 100 : 1000;
  const valid = Number.isFinite(percent) && percent >= 0 && percent <= max;

  return (
    <Modal open={open} onClose={onClose} title={t('estimate.duplicateWithMarkup')}>
      <div className="space-y-4">
        <div className="flex gap-1 rounded-xl bg-surface-sunken p-1">
          {[false, true].map((d) => (
            <button
              key={String(d)}
              type="button"
              onClick={() => setDiscount(d)}
              className={
                'flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ' +
                (discount === d ? 'bg-surface text-primary shadow-card' : 'text-muted')
              }
            >
              {d ? t('estimate.discount') : t('estimate.markup')}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted">
          {t(discount ? 'estimate.discountHint' : 'estimate.markupHint', { count })}
        </p>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted">
            {t(discount ? 'estimate.discountPercent' : 'estimate.markupPercent')}
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-12 w-full rounded-xl border border-border bg-surface px-3.5 text-base text-primary"
          />
        </label>
        {!online && <p className="text-xs text-danger">{offlineTitle}</p>}
        <Button
          fullWidth
          loading={loading}
          disabled={!valid || count === 0 || !online}
          onClick={() => onConfirm(percent, discount)}
        >
          {t('estimate.duplicateCreate')}
        </Button>
      </div>
    </Modal>
  );
}


/**
 * Mobile summary — a bottom sheet that peeks with just «До сплати» and taps / swipes up to about a
 * third of the screen to show the breakdown (works, materials, загальна знижка, deposit). It replaces
 * the always-on bar that ate the bottom of every list.
 *
 * <p>The peek is LEFT-aligned and the expanded content reserves a tall bottom padding on purpose: the
 * FAB is a separate fixed element (`bottom-20 right-4 z-50`) that floats ABOVE this sheet in that
 * empty right/bottom «dock». So the FAB never covers a number, and — because it is anchored to the
 * viewport, not to the sheet — it does not jump up when the sheet expands.</p>
 */
function MobileSummarySheet({ est }: { est: EstimateResponse }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const dragStartY = useRef<number | null>(null);

  // The only line that can be negative is a «−% від кошторису»; their sum is the загальна знижка to
  // flag. It is NOT subtracted again — est.total already includes it.
  const discount = est.items.reduce((sum, i) => (i.lineTotal < 0 ? sum + i.lineTotal : sum), 0);
  const hasDiscount = discount < 0;

  const onPointerDown = (e: ReactPointerEvent) => { dragStartY.current = e.clientY; };
  const onPointerUp = (e: ReactPointerEvent) => {
    if (dragStartY.current == null) return;
    const dy = e.clientY - dragStartY.current;
    dragStartY.current = null;
    // A real swipe wins; a small movement falls through to the onClick toggle.
    if (dy < -24) setExpanded(true);
    else if (dy > 24) setExpanded(false);
  };

  return (
    <>
      {/* Scrim while expanded — dims the list and taps to collapse. */}
      {expanded && (
        <button
          type="button"
          aria-label={t('common.close')}
          onClick={() => setExpanded(false)}
          className="fixed inset-0 z-30 bg-ink/40 lg:hidden"
        />
      )}
      <div className="fixed inset-x-0 bottom-0 z-40 rounded-t-2xl bg-ink pb-[env(safe-area-inset-bottom)] text-white shadow-card-lg lg:hidden">
        <div onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
          <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-white/25" aria-hidden />
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="flex w-full flex-col items-start px-5 pb-3 pt-1 text-left"
          >
            <span className="text-xs text-white/60">{t('estimate.toPay')}</span>
            <span className="flex items-center gap-2">
              <span data-testid="estimate-total" className="text-2xl font-extrabold tracking-tight">
                {formatMoney(est.total)}
              </span>
              {hasDiscount && !expanded && (
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/75">
                  {t('estimate.summaryDiscount')} {formatMoney(Math.abs(discount))}
                </span>
              )}
            </span>
          </button>
        </div>

        {/* The big bottom padding IS the FAB dock — content stops well above the floating button. */}
        {expanded && (
          <div className="px-5 pb-[9.5rem]">
            <div className="border-t border-white/10 pt-3">
              <TypeBreakdown items={est.items} type="WORK" subtotal={est.worksSubtotal} label={t('estimate.works')} />
              <TypeBreakdown items={est.items} type="MATERIAL" subtotal={est.materialsSubtotal} label={t('estimate.materials')} />
              <AdjustNote items={est.items} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * A works/materials row in the dark summary (card + sheet), with the estimate-level «% від кошторису»
 * broken out as a small sub-line («Надбавка 12 % +1 776» / «Знижка 5 % −725»). The main figure is the
 * BASE (the type's subtotal minus that adjustment), so base + adjustment reconciles to the subtotal the
 * total is built from — which is exactly what removes the «14 801 vs 16 577» confusion.
 */
export function TypeBreakdown({ items, type, subtotal, label }: {
  items: EstimateItemResponse[];
  type: 'WORK' | 'MATERIAL';
  subtotal: number;
  label: string;
}) {
  const { t } = useTranslation();
  const totalLines = items.filter(
    (i) => i.type === type && i.unit === 'PERCENT' && (i.percentBaseKind ?? 'MANUAL') === 'TOTAL',
  );
  const adjust = totalLines.reduce((s, i) => s + i.lineTotal, 0);
  // The percent is shown only when there is exactly ONE such line (the case the validation enforces);
  // a legacy estimate with several shows just the summed amount, no single percent.
  const percent = totalLines.length === 1 ? totalLines[0].quantity : null;
  // Lines frozen into a consolidated rollup — always kind=MANUAL now, so the TOTAL breakdown
  // above never sees them, and without this they'd fold silently into the base line with no hint
  // that part of it is a carried-over discount/markup rather than a fresh position. Split by
  // sign rather than netted: the type may carry BOTH a carried-over discount and a carried-over
  // markup (from different source estimates), and a single netted row would hide one against the
  // other — "we already know which is which" is the whole point of naming them separately.
  const frozenLines = items.filter((i) => i.type === type && i.unit === 'PERCENT' && i.baseOriginLabel);
  const frozenMarkup = frozenLines.filter((i) => i.lineTotal > 0).reduce((s, i) => s + i.lineTotal, 0);
  const frozenDiscount = frozenLines.filter((i) => i.lineTotal < 0).reduce((s, i) => s + i.lineTotal, 0);
  const base = Math.round((subtotal - adjust - frozenMarkup - frozenDiscount) * 100) / 100;
  return (
    <div className="mb-2.5">
      <div className="flex justify-between text-[13px] text-white/75">
        <span>{label}</span>
        <span>{formatMoney(base)}</span>
      </div>
      {adjust !== 0 && (
        <div className="mt-0.5 flex justify-between pl-3 text-xs text-white/55">
          <span>
            {t(adjust > 0 ? 'estimate.summaryMarkup' : 'estimate.summaryDiscount')}
            {percent != null ? ` ${formatNumber(Math.abs(percent), 2)}%` : ''}
          </span>
          <span>{adjust > 0 ? `+${formatMoney(adjust)}` : formatMoney(adjust)}</span>
        </div>
      )}
      {frozenDiscount !== 0 && (
        <div className="mt-0.5 flex justify-between pl-3 text-xs text-white/55">
          <span>{t('estimate.summaryFrozenDiscount')}</span>
          <span>{formatMoney(frozenDiscount)}</span>
        </div>
      )}
      {frozenMarkup !== 0 && (
        <div className="mt-0.5 flex justify-between pl-3 text-xs text-white/55">
          <span>{t('estimate.summaryFrozenMarkup')}</span>
          <span>{`+${formatMoney(frozenMarkup)}`}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Estimate-wide «Від кошторису» totals, folded across both types (markup ≥ 0, discount ≤ 0).
 * Also folds in FROZEN (consolidated-rollup) percent lines — a plain estimate never has any, so
 * this widening is a no-op there; a consolidated one otherwise showed no recap under «До
 * сплати» at all, since a frozen line is always kind=MANUAL, never TOTAL.
 */
export function adjustTotals(items: EstimateItemResponse[]): { markup: number; discount: number } {
  let markup = 0;
  let discount = 0;
  for (const i of items) {
    const isTotalPercent = i.unit === 'PERCENT' && (i.percentBaseKind ?? 'MANUAL') === 'TOTAL';
    const isFrozenPercent = i.unit === 'PERCENT' && Boolean(i.baseOriginLabel);
    if (isTotalPercent || isFrozenPercent) {
      if (i.lineTotal > 0) markup += i.lineTotal;
      else if (i.lineTotal < 0) discount += i.lineTotal;
    }
  }
  return { markup, discount };
}

/** The small grand-total note under «До сплати»: «Надбавка 1 776 ₴ · Знижка 725 ₴». */
function AdjustNote({ items }: { items: EstimateItemResponse[] }) {
  const { t } = useTranslation();
  const { markup, discount } = adjustTotals(items);
  if (markup <= 0 && discount >= 0) return null;
  const parts = [
    markup > 0 ? `${t('estimate.summaryMarkup')} ${formatMoney(markup)}` : null,
    discount < 0 ? `${t('estimate.summaryDiscount')} ${formatMoney(-discount)}` : null,
  ].filter(Boolean);
  return <div className="text-xs text-white/55">{parts.join(' · ')}</div>;
}

function ClientBanner({ project }: { project: ProjectResponse }) {
  const { t } = useTranslation();
  return (
    <div className="mb-4 flex items-center gap-3 rounded-card border border-brand-soft-2 bg-gradient-to-br from-brand-soft to-brand-soft-2 p-3.5">
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
        {initials(project.clientFullName) || '🏠'}
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-primary">
          {project.clientFullName ?? t('estimate.noClient')}
        </div>
        <div className="truncate text-xs text-ink-2/70">{project.address}</div>
      </div>
    </div>
  );
}

function SummaryCard({
  est,
  project,
}: {
  est: EstimateResponse;
  project: ProjectResponse | undefined;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-card bg-ink p-5 text-white">
      {project && (
        <div className="mb-4 flex items-center gap-2.5 border-b border-white/10 pb-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-[13px] font-bold">
            {initials(project.clientFullName) || '🏠'}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {project.clientFullName ?? t('estimate.noClient')}
            </div>
            <div className="truncate text-xs text-white/60">{project.name}</div>
          </div>
        </div>
      )}
      <TypeBreakdown items={est.items} type="WORK" subtotal={est.worksSubtotal} label={t('estimate.works')} />
      <TypeBreakdown items={est.items} type="MATERIAL" subtotal={est.materialsSubtotal} label={t('estimate.materials')} />
      <div className="mt-1 border-t border-white/10 pt-3 text-[13px] font-semibold">{t('estimate.toPay')}</div>
      <div data-testid="estimate-total" className="my-1.5 text-2xl font-extrabold tracking-tight">
        {formatMoney(est.total)}
      </div>
      <AdjustNote items={est.items} />
    </div>
  );
}
