import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Input } from '@/components/Input.tsx';
import { Button } from '@/components/Button.tsx';
import { Chip } from '@/components/Chip.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { formatMoney } from '@/lib/format.ts';
import { cn } from '@/lib/cn.ts';
import { useMe } from '@/features/auth/useMe.ts';
import { useCatalog } from '@/features/catalog/useCatalog.ts';
import {
  TradeFilterChips,
  tradeMatches,
  type TradeKey,
} from '@/features/catalog/TradeFilterChips.tsx';
import {
  SaveToCatalogPrompt,
  type CatalogSaveDraft,
} from '@/features/catalog/SaveToCatalogPrompt.tsx';
import { ItemForm } from './ItemForm.tsx';
import { useAddItem, useAddItemsFromCatalogBatch } from './useEstimate.ts';
import type { ItemType } from '@/api/types.ts';

type Tab = 'catalog' | 'manual';

type TypeFilter = ItemType | 'ALL';
const TYPE_FILTERS: { value: TypeFilter; labelKey: string }[] = [
  { value: 'ALL', labelKey: 'common.all' },
  { value: 'WORK', labelKey: 'catalog.filterWorks' },
  { value: 'MATERIAL', labelKey: 'catalog.filterMaterials' },
];

export function AddItemSheet({
  estimateId,
  objectId,
  nextSortOrder,
  open,
  onClose,
}: {
  estimateId: string;
  /** The object (project) id — enables "Вибрати з замірів" in the manual tab. */
  objectId?: string;
  nextSortOrder: number;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('catalog');
  const [catalogPrompt, setCatalogPrompt] = useState<CatalogSaveDraft | null>(null);
  const addItem = useAddItem(estimateId);

  const close = () => {
    setTab('catalog');
    setCatalogPrompt(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title={catalogPrompt ? t('estimate.saveToCatalogTitle') : t('estimate.addItemTitle')}
    >
      {catalogPrompt ? (
        <SaveToCatalogPrompt item={catalogPrompt} onClose={close} />
      ) : (
        <>
          <div className="mb-4 flex gap-1 rounded-xl bg-surface-sunken p-1">
            {(['catalog', 'manual'] as Tab[]).map((tabKey) => (
              <button
                key={tabKey}
                type="button"
                onClick={() => setTab(tabKey)}
                className={cn(
                  'flex-1 rounded-lg py-2 text-sm font-semibold transition-colors',
                  tab === tabKey ? 'bg-surface text-primary shadow-card' : 'text-muted',
                )}
              >
                {tabKey === 'catalog' ? t('estimate.fromCatalog') : t('estimate.manual')}
              </button>
            ))}
          </div>

          {tab === 'catalog' ? (
            <CatalogPicker estimateId={estimateId} nextSortOrder={nextSortOrder} onDone={close} />
          ) : (
            <ItemForm
              objectId={objectId}
              showSaveToCatalog
              enableAutocomplete
              submitLabel={t('common.add')}
              submitting={addItem.isPending}
              onSubmit={async (req, offerCatalog) => {
                try {
                  await addItem.mutateAsync({ ...req, sortOrder: nextSortOrder });
                  toast.success(t('estimate.itemAdded'));
                  // Offer to save a genuinely new manual item to the catalog (not
                  // one picked from the autocomplete — that's already there). The
                  // line's category/price prefill the prompt.
                  if (offerCatalog) {
                    setCatalogPrompt({
                      name: req.name,
                      type: req.type,
                      unit: req.unit,
                      category: req.category,
                      unitPrice: req.unitPrice,
                    });
                  } else {
                    close();
                  }
                } catch (err) {
                  toast.error(toAppError(err).message);
                }
              }}
            />
          )}
        </>
      )}
    </Modal>
  );
}

/**
 * Browse the catalog, filter by trade (2+ trades) + name, multi-select several
 * positions, then add them all at once with a single batch request. Quantity
 * starts at 1 (adjusted in the estimate). The "manual" tab keeps the type-ahead
 * autocomplete for precise single adds — this surface is the fast bulk path.
 */
function CatalogPicker({
  estimateId,
  nextSortOrder,
  onDone,
}: {
  estimateId: string;
  nextSortOrder: number;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { data, isPending } = useCatalog();
  const { data: me } = useMe();
  const batch = useAddItemsFromCatalogBatch(estimateId);
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [tradeFilter, setTradeFilter] = useState<Set<TradeKey>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const hasOther = useMemo(() => (data ?? []).some((i) => i.trade == null || i.trade === 'OTHER'), [data]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? [])
      .filter((i) => typeFilter === 'ALL' || i.type === typeFilter)
      .filter((i) => tradeMatches(i.trade, tradeFilter))
      .filter((i) => !needle || i.name.toLowerCase().includes(needle));
  }, [data, q, typeFilter, tradeFilter]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const add = async () => {
    if (selected.size === 0) return;
    const items = [...selected].map((id, i) => ({
      catalogItemId: id,
      quantity: 1,
      sortOrder: nextSortOrder + i,
    }));
    try {
      await batch.mutateAsync(items);
      toast.success(t('estimate.itemsAdded', { count: items.length }));
      onDone();
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  return (
    <div>
      <TradeFilterChips
        userTrades={me?.trades ?? []}
        hasOther={hasOther}
        value={tradeFilter}
        onChange={setTradeFilter}
      />
      <div className="mb-3 flex gap-2">
        {TYPE_FILTERS.map((f) => (
          <Chip
            key={f.value}
            active={typeFilter === f.value}
            onClick={() => setTypeFilter(f.value)}
          >
            {t(f.labelKey)}
          </Chip>
        ))}
      </div>
      <Input
        placeholder={t('estimate.searchCatalog')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="mb-3"
      />
      <div className="max-h-[40dvh] space-y-1.5 overflow-y-auto">
        {isPending ? (
          <p className="py-6 text-center text-sm text-muted">{t('common.loading')}</p>
        ) : filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">{t('estimate.catalogEmptyResult')}</p>
        ) : (
          filtered.map((item) => {
            const checked = selected.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                data-testid="catalog-row"
                onClick={() => toggle(item.id)}
                className={cn(
                  'flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors',
                  checked ? 'border-brand bg-brand-soft' : 'border-border bg-surface',
                )}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={cn(
                      'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border text-xs',
                      checked ? 'border-brand bg-brand text-white' : 'border-border text-transparent',
                    )}
                  >
                    ✓
                  </span>
                  <span className="min-w-0">
                    <span className="block break-words text-sm font-medium text-primary">
                      {item.name}
                    </span>
                    <span className="block text-xs text-muted">
                      {t('unitPer', { unit: t('units.' + item.unit) })}
                    </span>
                  </span>
                </span>
                <span className="whitespace-nowrap text-sm font-semibold text-primary">
                  {formatMoney(item.defaultPrice)}
                </span>
              </button>
            );
          })
        )}
      </div>

      {selected.size > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="mb-2 text-center text-xs text-muted">{t('estimate.batchQtyHint')}</p>
          <Button fullWidth loading={batch.isPending} onClick={add}>
            {t('estimate.addNItems', { count: selected.size })}
          </Button>
        </div>
      )}
    </div>
  );
}
