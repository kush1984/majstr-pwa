import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Input } from '@/components/Input.tsx';
import { Button } from '@/components/Button.tsx';
import { FormField } from '@/components/FormField.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { formatMoney } from '@/lib/format.ts';
import { parseDecimal } from '@/lib/decimal.ts';
import { cn } from '@/lib/cn.ts';
import { useCatalog, useCreateCatalogItem } from '@/features/catalog/useCatalog.ts';
import type { CatalogItemResponse } from '@/api/types.ts';
import { ItemForm } from './ItemForm.tsx';
import { useAddItem, useAddItemFromCatalog } from './useEstimate.ts';

type Tab = 'catalog' | 'manual';

export function AddItemSheet({
  estimateId,
  nextSortOrder,
  open,
  onClose,
}: {
  estimateId: string;
  nextSortOrder: number;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('catalog');
  const addItem = useAddItem(estimateId);
  const addFromCatalog = useAddItemFromCatalog(estimateId);
  const createCatalog = useCreateCatalogItem();

  const close = () => {
    setTab('catalog');
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title={t('estimate.addItemTitle')}>
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
        <CatalogPicker
          picking={addFromCatalog.isPending}
          onPick={async (item, qty) => {
            const quantity = parseDecimal(qty);
            if (!Number.isFinite(quantity) || quantity <= 0) {
              toast.error(t('estimate.enterQuantity'));
              return;
            }
            try {
              await addFromCatalog.mutateAsync({
                catalogItemId: item.id,
                req: { quantity, sortOrder: nextSortOrder },
              });
              toast.success(t('estimate.itemAdded'));
              close();
            } catch (err) {
              toast.error(toAppError(err).message);
            }
          }}
        />
      ) : (
        <ItemForm
          showSaveToCatalog
          enableAutocomplete
          submitLabel={t('common.add')}
          submitting={addItem.isPending}
          onSubmit={async (req, saveToCatalog) => {
            try {
              await addItem.mutateAsync({ ...req, sortOrder: nextSortOrder });
              if (saveToCatalog) {
                await createCatalog.mutateAsync({
                  name: req.name,
                  category: req.category,
                  type: req.type,
                  unit: req.unit,
                  defaultPrice: req.unitPrice,
                });
              }
              toast.success(t('estimate.itemAdded'));
              close();
            } catch (err) {
              toast.error(toAppError(err).message);
            }
          }}
        />
      )}
    </Modal>
  );
}

/** Search the catalog, pick an item, then enter a quantity. */
function CatalogPicker({
  onPick,
  picking,
}: {
  onPick: (item: CatalogItemResponse, quantity: string) => void;
  picking: boolean;
}) {
  const { t } = useTranslation();
  const { data, isPending } = useCatalog();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<CatalogItemResponse | null>(null);
  const [qty, setQty] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const items = data ?? [];
    return needle ? items.filter((i) => i.name.toLowerCase().includes(needle)) : items;
  }, [data, q]);

  if (selected) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setSelected(null)}
          className="mb-3 text-sm font-medium text-brand"
        >
          ← {selected.name}
        </button>
        <FormField
          label={t('estimate.quantityWithUnit', { unit: t('units.' + selected.unit) })}
          htmlFor="pick-qty"
          required
        >
          <Input
            id="pick-qty"
            inputMode="decimal"
            autoFocus
            placeholder="0"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </FormField>
        <p className="mb-4 mt-1 text-xs text-muted">
          {t('estimate.catalogPrice', {
            price: formatMoney(selected.defaultPrice),
            unit: t('units.' + selected.unit),
          })}
        </p>
        <Button fullWidth loading={picking} onClick={() => onPick(selected, qty)}>
          {t('common.add')}
        </Button>
      </div>
    );
  }

  return (
    <div>
      <Input
        placeholder={t('estimate.searchCatalog')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="mb-3"
      />
      <div className="max-h-[46dvh] space-y-1.5 overflow-y-auto">
        {isPending ? (
          <p className="py-6 text-center text-sm text-muted">{t('common.loading')}</p>
        ) : filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            {t('estimate.catalogEmptyResult')}
          </p>
        ) : (
          filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              data-testid="catalog-row"
              onClick={() => {
                setSelected(item);
                setQty('');
              }}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-left"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-primary">{item.name}</span>
                <span className="block text-xs text-muted">
                  {t('unitPer', { unit: t('units.' + item.unit) })}
                </span>
              </span>
              <span className="whitespace-nowrap text-sm font-semibold text-primary">
                {formatMoney(item.defaultPrice)}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
