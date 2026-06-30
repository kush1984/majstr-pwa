import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/Input.tsx';
import { Select } from '@/components/Select.tsx';
import { FormField } from '@/components/FormField.tsx';
import { Button } from '@/components/Button.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { parseDecimal } from '@/lib/decimal.ts';
import { useMe } from '@/features/auth/useMe.ts';
import { useCatalogCategories, useCreateCatalogItem } from '@/features/catalog/useCatalog.ts';
import type { ItemType, Trade, Unit } from '@/api/types.ts';

/** The just-added item to offer for catalog saving. category / unitPrice are
 *  prefilled where known (estimate line) and entered fresh where not (template). */
export type CatalogSaveDraft = {
  name: string;
  type: ItemType;
  unit: Unit;
  category?: string;
  unitPrice?: number;
};

/**
 * "Save this position to your catalog too?" — shown after a manual add. Name,
 * type and unit carry over from the item; the master picks the category, trade
 * (only with 2+ trades) and unit price for the catalog entry. An empty price
 * stores 0 (the catalog allows it). Reusable across the estimate and template
 * manual-add flows.
 */
export function SaveToCatalogPrompt({
  item,
  onClose,
}: {
  item: CatalogSaveDraft;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const categories = useCatalogCategories();
  const createCatalog = useCreateCatalogItem();
  const showTrade = (me?.trades.length ?? 0) >= 2;
  // "Інше" (OTHER) is always an option and the default — the single catch-all.
  const tradeOptions: Trade[] = [...(me?.trades ?? [])];
  if (!tradeOptions.includes('OTHER')) tradeOptions.push('OTHER');
  const [category, setCategory] = useState(item.category ?? '');
  const [trade, setTrade] = useState<Trade>('OTHER');
  const [price, setPrice] = useState(item.unitPrice != null ? String(item.unitPrice) : '');

  const onAdd = async () => {
    try {
      await createCatalog.mutateAsync({
        name: item.name,
        category: category.trim() || undefined,
        trade: showTrade ? trade : 'OTHER',
        type: item.type,
        unit: item.unit,
        defaultPrice: parseDecimal(price),
      });
      toast.success(t('estimate.savedToCatalog'));
      onClose();
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-secondary">
        {t('estimate.saveToCatalogQuestion', { name: item.name })}
      </p>

      <FormField label={t('estimate.category')} htmlFor="stc-category">
        <Input
          id="stc-category"
          list="stc-category-list"
          placeholder={t('estimate.categoryPlaceholder')}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        />
        <datalist id="stc-category-list">
          {(categories.data ?? []).map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </FormField>

      {showTrade && (
        <FormField label={t('catalog.tradeLabel')} htmlFor="stc-trade">
          <Select id="stc-trade" value={trade} onChange={(e) => setTrade(e.target.value as Trade)}>
            {tradeOptions.map((tr) => (
              <option key={tr} value={tr}>
                {t('trades.' + tr)}
              </option>
            ))}
          </Select>
        </FormField>
      )}

      <FormField label={t('catalog.priceLabel')} htmlFor="stc-price">
        <Input
          id="stc-price"
          inputMode="decimal"
          placeholder="0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </FormField>

      <div className="flex gap-2 pt-1">
        <Button variant="secondary" fullWidth onClick={onClose}>
          {t('estimate.saveToCatalogSkip')}
        </Button>
        <Button fullWidth loading={createCatalog.isPending} onClick={onAdd}>
          {t('estimate.saveToCatalogYes')}
        </Button>
      </div>
    </div>
  );
}
