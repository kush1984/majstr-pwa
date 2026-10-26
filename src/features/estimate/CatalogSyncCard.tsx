import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CatalogSyncRequest, EstimateItemResponse } from '@/api/types.ts';
import { Button } from '@/components/Button.tsx';
import { Modal } from '@/components/Modal.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { formatMoney } from '@/lib/format.ts';
import { toastUndoable } from '@/lib/inlineEdit.ts';
import { track } from '@/lib/posthog.ts';
import { newUuid } from '@/lib/uuid.ts';
import { useCatalog, useCatalogSync, useDeleteCatalogItems } from '@/features/catalog/useCatalog.ts';
import { catalogDivergence, rememberNotNow, shouldShowCard, type CatalogDivergence } from './catalogSync.ts';

/**
 * «Ціни в N позиціях відрізняються від каталогу» — a QUIET card under «Кошторис готовий?», never a
 * popup per edit. Shown only while there is something to say on an unsigned estimate; «Не зараз»
 * hides it until a divergence appears that was not on it then.
 */
export function CatalogSyncCard({ estimateId, items }: { estimateId: string; items: EstimateItemResponse[] }) {
  const { t } = useTranslation();
  const catalog = useCatalog();
  const [sheetOpen, setSheetOpen] = useState(false);
  // Bumped by «Не зараз» so the card re-reads what it remembered.
  const [notNowAt, setNotNowAt] = useState(0);

  const divergence = useMemo(
    () => (catalog.data ? catalogDivergence(items, catalog.data) : { differs: [], missing: [] }),
    [items, catalog.data],
  );
  // Read on every render (one localStorage lookup): «Не зараз» re-renders through `notNowAt`.
  const visible = notNowAt >= 0 && shouldShowCard(estimateId, divergence);

  if (!catalog.data || (!visible && !sheetOpen)) return null;
  const n = divergence.differs.length;
  const m = divergence.missing.length;

  return (
    <>
      {visible && (
        <section className="mt-3 rounded-xl border border-amber/30 bg-amber-soft/50 px-4 py-3 text-sm">
          <h3 className="font-semibold text-primary">
            {n > 0 ? t('estimate.catalogSync.title', { count: n }) : t('estimate.catalogSync.titleMissingOnly', { count: m })}
          </h3>
          {n > 0 && <p className="mt-1 text-muted">{t('estimate.catalogSync.onlyHere')}</p>}
          {n > 0 && m > 0 && <p className="text-muted">{t('estimate.catalogSync.alsoMissing', { count: m })}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button onClick={() => setSheetOpen(true)}>{t('estimate.catalogSync.open')}</Button>
            <Button
              variant="ghost"
              onClick={() => {
                rememberNotNow(estimateId, divergence);
                setNotNowAt(Date.now());
              }}
            >
              {t('estimate.catalogSync.notNow')}
            </Button>
          </div>
        </section>
      )}
      <Modal open={sheetOpen} onClose={() => setSheetOpen(false)} title={t('estimate.catalogSync.sheetTitle')}>
        {sheetOpen && (
          <SyncSheet divergence={divergence} onDone={() => setSheetOpen(false)} />
        )}
      </Modal>
    </>
  );
}

function SyncSheet({ divergence, onDone }: { divergence: CatalogDivergence; onDone: () => void }) {
  const { t } = useTranslation();
  const sync = useCatalogSync();
  const deleteItems = useDeleteCatalogItems();
  // «Інша ціна» is ticked unless it is BELOW the catalog (a one-off discount must not spoil it);
  // «Немає в каталозі» is never pre-ticked — a reworded line looks «new» and would litter the catalog.
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(divergence.differs.filter((d) => !d.lower).map((d) => d.key)),
  );
  const toggle = (key: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (!next.delete(key)) next.add(key);
    return next;
  });
  const k = picked.size;
  const unit = (u: string) => t('units.' + u);

  const apply = () => {
    const updates = divergence.differs.filter((d) => picked.has(d.key));
    const creates = divergence.missing.filter((d) => picked.has(d.key)).map((d) => ({ d, id: newUuid() }));
    const req: CatalogSyncRequest = {
      updates: updates.map((d) => ({ catalogItemId: d.catalog.id, defaultPrice: d.price })),
      creates: creates.map(({ d, id }) => ({
        id, name: d.line.name.trim(), category: d.line.category, trade: d.trade,
        type: d.line.type, unit: d.line.unit, defaultPrice: d.price,
      })),
    };
    const fail = (err: unknown) => toast.error(toAppError(err).message);
    track('catalog_sync_apply', { updated: req.updates.length, added: req.creates.length });
    sync.mutate({ batchId: newUuid(), req }, { onError: fail });
    toastUndoable(t('estimate.catalogSync.applied', { count: k }), () => {
      // The whole batch back: the old prices as one more sync, and what it added deleted.
      if (updates.length > 0) {
        sync.mutate({
          batchId: newUuid(),
          req: { updates: updates.map((d) => ({ catalogItemId: d.catalog.id, defaultPrice: d.catalog.defaultPrice })), creates: [] },
        }, { onError: fail });
      }
      if (creates.length > 0) deleteItems.mutate(creates.map((c) => c.id), { onError: fail });
    });
    onDone();
  };

  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted">{t('estimate.catalogSync.sheetSubtitle')}</p>

      {divergence.differs.length > 0 && (
        <section>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t('estimate.catalogSync.sectionPrice')}</h4>
          <ul className="space-y-1">
            {divergence.differs.map((d) => (
              <li key={d.key}>
                <label className="flex min-h-[44px] items-start gap-3 rounded-lg px-1 py-2 active:bg-surface-sunken">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-5 w-5 flex-shrink-0 accent-brand"
                    checked={picked.has(d.key)}
                    onChange={() => toggle(d.key)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-medium text-primary">{d.line.name}</span>
                    <span className="text-muted">
                      {t('estimate.catalogSync.inCatalog')}{' '}
                      <s>{formatMoney(d.catalog.defaultPrice)}</s> → <b className="text-primary">{formatMoney(d.price)}</b>
                      {' / '}{unit(d.line.unit)}
                    </span>
                    {d.lower && (
                      <span className="ml-2 rounded-full bg-amber-soft px-2 py-0.5 text-[11px] text-amber-strong">
                        {t('estimate.catalogSync.discount')}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {divergence.missing.length > 0 && (
        <section>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t('estimate.catalogSync.sectionMissing')}</h4>
          <ul className="space-y-1">
            {divergence.missing.map((d) => (
              <li key={d.key}>
                <label className="flex min-h-[44px] items-start gap-3 rounded-lg px-1 py-2 active:bg-surface-sunken">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-5 w-5 flex-shrink-0 accent-brand"
                    checked={picked.has(d.key)}
                    onChange={() => toggle(d.key)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-medium text-primary">{d.line.name}</span>
                    <span className="text-muted">
                      {t('estimate.catalogSync.addWith', { price: formatMoney(d.price), unit: unit(d.line.unit) })}
                      {' · '}{t('trades.' + d.trade)}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div>
        <Button className="w-full" disabled={k === 0} onClick={apply}>
          {t('estimate.catalogSync.apply', { count: k })}
        </Button>
        <p className="mt-1.5 text-center text-[12px] text-faint">{t('estimate.catalogSync.noCrewPrices')}</p>
      </div>
    </div>
  );
}
