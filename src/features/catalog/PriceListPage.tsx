import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Skeleton } from '@/components/Skeleton.tsx';
import { ErrorState } from '@/components/ErrorState.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { priceListApi } from '@/api/priceList.ts';
import type { CatalogItemResponse, PriceListResponse } from '@/api/types.ts';
import { routes } from '@/lib/config.ts';
import { cn } from '@/lib/cn.ts';
import { copyWhenReady } from '@/lib/asyncClipboard.ts';
import { canShareNatively, shareNatively } from '@/lib/shareLink.ts';
import { sharePdf } from '@/lib/sharePdf.ts';
import { useOnlineGuard } from '@/hooks/useOnlineGuard.ts';
import { useClientPreview } from '@/features/estimate/useClientPreview.ts';
import { useSenderGate } from '@/features/sender/senderGate.ts';
import { useVisibleCatalog } from './useCatalog.ts';
import { CatalogBoard, tickableIds, type CatalogSelection } from './CatalogBoard.tsx';
import { TradeLevel, tradeBranchLabel } from './TradeLevel.tsx';
import { toTradeTree } from './catalogTree.ts';

const PRICE_LIST_KEY = ['price-list'];
const SEARCH_FROM = 8;

/**
 * «Прайс для клієнта» (V205) — a screen of its own: the master ticks the works the client will see, and
 * shares them from the same screen. Nothing is ticked for him; what he ticked last time comes back.
 * A work with no price cannot be ticked — a client must never read «0 ₴».
 */
export function PriceListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { online } = useOnlineGuard();
  const catalog = useVisibleCatalog();
  const state = useQuery({ queryKey: PRICE_LIST_KEY, queryFn: () => priceListApi.get() });
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<'share' | 'copy' | 'pdf' | 'revoke' | null>(null);
  const [shownUrl, setShownUrl] = useState<string | null>(null);
  const nativeShare = canShareNatively();

  useEffect(() => {
    if (picked === null && state.data) setPicked(new Set(state.data.itemIds));
  }, [picked, state.data]);

  const works = useMemo(() => (catalog.data ?? []).filter((i) => i.type === 'WORK'), [catalog.data]);
  const searching = q.trim().length > 0;
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle === '' ? works : works.filter((i) => i.name.toLowerCase().includes(needle));
  }, [works, q]);
  const branches = useMemo(() => toTradeTree(visible), [visible]);
  const showTrades = branches.length > 1;
  const isOpen = (key: string) => searching || !showTrades || (open[key] ?? false);
  const toggleOpen = (key: string) => setOpen((prev) => ({ ...prev, [key]: !(prev[key] ?? false) }));

  // A tick the server kept on a work since set to 0 ₴, or of a trade taken off the profile, is not on
  // screen to untick — so it is neither counted nor sent.
  const ticked = useMemo(() => {
    const tickable = new Set(works.filter((i) => i.defaultPrice > 0).map((i) => i.id));
    return new Set([...(picked ?? [])].filter((id) => tickable.has(id)));
  }, [picked, works]);
  const toggleMany = (ids: string[], select: boolean) => setPicked((prev) => {
    const next = new Set(prev);
    ids.forEach((id) => (select ? next.add(id) : next.delete(id)));
    return next;
  });
  const selection: CatalogSelection = {
    selected: ticked,
    onToggle: (id) => setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    }),
    onToggleSection: toggleMany,
    noteOf: (item: CatalogItemResponse) =>
      item.defaultPrice <= 0 ? { text: t('priceList.noPrice'), blocked: true } : null,
  };

  const itemIds = [...ticked];
  const nothing = itemIds.length === 0;
  const locked = busy !== null || !online;
  const adopt = (next: PriceListResponse) => qc.setQueryData(PRICE_LIST_KEY, next);
  const fail = (err: unknown) => toast.error(toAppError(err).message);
  const save = async (): Promise<string> => {
    const next = await priceListApi.save({ itemIds });
    adopt(next);
    if (!next.url) throw new Error('price list saved without a link');
    return next.url;
  };
  // Looking is not sending: the preview saves the ticks on a ten-minute pass and mints no link.
  const preview = useClientPreview(
    () => priceListApi.preview({ itemIds }).then((r) => r.url),
    () => Promise.resolve(true),
  );

  const ensureSender = useSenderGate();
  // Every way out needs the master's name on the page first, as an estimate's share does (V190).
  const run = async (kind: NonNullable<typeof busy>, work: () => Promise<void>) => {
    if (kind !== 'revoke' && (await ensureSender()) === 'cancelled') return;
    setBusy(kind);
    try {
      await work();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };
  const onShare = () => run('share', async () => {
    const url = await save();
    const outcome = await shareNatively(url, t('priceList.shareText'));
    if (outcome === 'blocked') {
      setShownUrl(url);
      toast.info(t('portal.shareTapAgain'));
    }
  });
  const onCopy = () => run('copy', async () => {
    const { copied, value } = await copyWhenReady(save);
    if (copied) {
      toast.success(t('estimate.linkCopied'));
    } else {
      setShownUrl(value);
      toast.error(t('estimate.linkCopyFailed'));
    }
  });
  const onPdf = () => run('pdf', async () => {
    await save();
    const blob = await priceListApi.fetchPdfBlob();
    await sharePdf(blob, `${t('priceList.fileName')}.pdf`, t('priceList.title'));
  });
  const onRevoke = () => run('revoke', async () => {
    adopt(await priceListApi.revoke());
    setShownUrl(null);
    toast.success(t('portal.linkClosed'));
  });

  const loading = catalog.isPending || state.isPending || picked === null;
  const failed = (catalog.isError && !catalog.data) || state.isError;

  return (
    <>
      <button
        type="button"
        onClick={() => navigate(routes.catalog)}
        className="mb-2 -ml-1 min-h-[44px] px-1 text-sm font-semibold text-brand"
      >
        ← {t('catalog.title')}
      </button>
      <h1 className="text-2xl font-extrabold tracking-tight text-primary">{t('priceList.title')}</h1>
      <p className="mb-3 mt-1 text-sm text-muted">{t('priceList.pageHint')}</p>

      {state.data?.url && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-xl bg-success-soft px-3 py-2">
          <span className="text-xs font-semibold text-success">{t('priceList.linkLive')}</span>
          <button
            type="button"
            disabled={locked}
            onClick={() => void onRevoke()}
            className="min-h-[36px] text-xs font-semibold text-danger disabled:opacity-50"
          >
            {t('portal.closeLink')}
          </button>
        </div>
      )}

      {works.length > SEARCH_FROM && (
        <Input
          placeholder={t('estimate.searchCatalog')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="mb-3"
        />
      )}

      {failed ? (
        <ErrorState
          error={catalog.error ?? state.error}
          title={t('catalog.loadErrorTitle')}
          what={t('offline.dataCatalog')}
          onRetry={() => { void catalog.refetch(); void state.refetch(); }}
        />
      ) : loading ? (
        <div className="space-y-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : works.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">{t('priceList.noWorks')}</p>
      ) : (
        <div className="space-y-2 pb-4">
          {branches.map((branch) => {
            const ids = tickableIds(branch.sections.flatMap((s) => s.items), selection);
            const all = ids.length > 0 && ids.every((id) => ticked.has(id));
            const here = branch.sections.flatMap((s) => s.items).filter((i) => ticked.has(i.id)).length;
            return (
              <TradeLevel
                key={branch.key}
                show={showTrades}
                tradeKey={branch.key}
                customName={branch.customName}
                count={branch.count}
                badge={here}
                open={isOpen(`t:${branch.key}`)}
                onToggle={searching ? undefined : () => toggleOpen(`t:${branch.key}`)}
                testId="price-list-trade"
                bodyClass="space-y-2"
                leading={
                  <button
                    type="button"
                    onClick={() => toggleMany(ids, !all)}
                    aria-pressed={all}
                    aria-label={tradeBranchLabel(branch.key, branch.customName, t)}
                    className="flex h-11 w-7 flex-shrink-0 items-center justify-center"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'flex h-5 w-5 items-center justify-center rounded border text-[11px] font-bold',
                        all ? 'border-brand bg-brand text-white' : 'border-border text-transparent',
                      )}
                    >
                      ✓
                    </span>
                  </button>
                }
              >
                <CatalogBoard
                  sections={branch.sections}
                  onEdit={() => {}}
                  selection={selection}
                  isCategoryOpen={(category) => isOpen(`c:${branch.key}|${category}`)}
                  onToggleCategory={searching ? undefined : (category) => toggleOpen(`c:${branch.key}|${category}`)}
                />
              </TradeLevel>
            );
          })}
        </div>
      )}

      {/* Full width, just above the bottom menu: what goes out, and every way to send it. */}
      {!loading && !failed && works.length > 0 && (
        <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 -mx-4 mt-2 space-y-2 border-t border-border bg-surface px-4 pb-3 pt-3 shadow-card-lg sm:mx-0 sm:rounded-2xl sm:border lg:bottom-4">
          <p className="text-sm font-semibold text-primary">
            {nothing ? t('priceList.pickSome') : t('priceList.count', { count: itemIds.length })}
          </p>
          {shownUrl && <Input readOnly value={shownUrl} onFocus={(e) => e.currentTarget.select()} />}
          {nativeShare ? (
            <Button fullWidth disabled={nothing || locked} loading={busy === 'share'} onClick={() => void onShare()}>
              {t('estimate.shareNative')}
            </Button>
          ) : (
            <Button fullWidth disabled={nothing || locked} loading={busy === 'copy'} onClick={() => void onCopy()}>
              {t('estimate.copyLink')}
            </Button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              disabled={nothing || locked || preview.opening}
              loading={preview.opening}
              onClick={() => void preview.open()}
            >
              👁 {t('priceList.preview')}
            </Button>
            <Button variant="secondary" disabled={nothing || locked} loading={busy === 'pdf'} onClick={() => void onPdf()}>
              {t('priceList.pdf')}
            </Button>
          </div>
          {nativeShare && (
            <button
              type="button"
              disabled={nothing || locked}
              onClick={() => void onCopy()}
              className="min-h-[36px] w-full text-center text-xs font-semibold text-brand disabled:opacity-50"
            >
              {t('estimate.copyLink')}
            </button>
          )}
        </div>
      )}
    </>
  );
}
