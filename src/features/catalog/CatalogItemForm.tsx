import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Select } from '@/components/Select.tsx';
import { FormField } from '@/components/FormField.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { useMe } from '@/features/auth/useMe.ts';
import { customTradeKey, parseCustomTradeKey, type TradeKey } from './tradeKey.ts';
import type { CatalogItemRequest, CatalogItemResponse, Trade } from '@/api/types.ts';
import {
  catalogItemSchema,
  parsePrice,
  ITEM_TYPE_OPTIONS,
  UNIT_OPTIONS,
  type CatalogItemFormValues,
} from './catalogItemSchema.ts';
import {
  useCatalog,
  useCreateCatalogItem,
  useDeleteCatalogItem,
  useUpdateCatalogItem,
} from './useCatalog.ts';

/** The item's current trade as a picker key — its custom trade if it has one, else its
 *  system trade (never null: "Інше" is OTHER, never a bare null). */
function itemTradeKey(item: { trade: Trade | null; customTradeId: string | null }): TradeKey {
  return item.customTradeId ? customTradeKey(item.customTradeId) : (item.trade ?? 'OTHER');
}

/**
 * Create / edit a catalog item. Rendered inside a Modal by the page.
 * `initial` null → create mode; an item → edit mode (with a delete action).
 */
export function CatalogItemForm({
  initial,
  defaultTradeKey,
  onDone,
}: {
  initial: CatalogItemResponse | null;
  /** Pre-select this trade on create (the catalog's active trade filter). */
  defaultTradeKey?: TradeKey;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const isEdit = Boolean(initial);
  const create = useCreateCatalogItem();
  const update = useUpdateCatalogItem();
  const del = useDeleteCatalogItem();
  // Categories come from the catalog list rather than the /categories endpoint: this query
  // carries each item's TRADE (so the dropdown can be narrowed to the one being edited) and it is
  // the query the offline prefetch stores, so the dropdown is populated with no connection too.
  const catalog = useCatalog();
  const { data: me } = useMe();
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Always offer the item's CURRENT trade as an option, even if the master no longer works in
  // it (removed from profile, or its custom trade was since deleted) — otherwise editing the
  // item would silently fall back to the first option and wipe its trade on save.
  const tradeOptions: { key: TradeKey; label: string }[] = (() => {
    const opts: { key: TradeKey; label: string }[] = (me?.trades ?? [])
      .map((tr) => ({ key: tr, label: t('trades.' + tr) }));
    for (const ct of me?.customTrades ?? []) {
      opts.push({ key: customTradeKey(ct.id), label: ct.name });
    }
    // "Інше" (OTHER) is always offered — the single catch-all for no specific trade.
    if (!opts.some((o) => o.key === 'OTHER')) opts.push({ key: 'OTHER', label: t('trades.OTHER') });
    if (initial) {
      const current = itemTradeKey(initial);
      if (!opts.some((o) => o.key === current)) {
        opts.unshift({ key: current, label: initial.customTradeName ?? t('trades.' + initial.trade) });
      }
    }
    return opts;
  })();
  // Only worth choosing a trade when there is more than one option.
  const showTrade = tradeOptions.length >= 2;

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<CatalogItemFormValues>({
    resolver: zodResolver(catalogItemSchema),
    defaultValues: initial
      ? {
          name: initial.name,
          type: initial.type,
          unit: initial.unit,
          category: initial.category ?? '',
          newCategory: '',
          tradeChoice: itemTradeKey(initial),
          defaultPrice: String(initial.defaultPrice),
        }
      : {
          name: '',
          type: 'WORK',
          unit: 'PIECE',
          category: '',
          newCategory: '',
          tradeChoice: defaultTradeKey ?? 'OTHER',
          defaultPrice: '',
        },
  });

  // The trade is live: picking a different one re-narrows the category list under it.
  const selectedTradeChoice = watch('tradeChoice') as TradeKey;
  const selectedCategory = watch('category');
  const categoryOptions = useMemo(() => {
    const found = new Set<string>();
    for (const item of catalog.data ?? []) {
      const c = item.category?.trim();
      if (c && itemTradeKey(item) === selectedTradeChoice) found.add(c);
    }
    // Whatever is currently selected stays on the list even when it belongs to another trade.
    // Without this, switching trade would leave the <select> pointing at a value it no longer
    // offers — the browser falls back to the first option, and the category is gone on save.
    for (const own of [initial?.category?.trim(), selectedCategory?.trim()]) {
      if (own) found.add(own);
    }
    return [...found].sort((a, b) => a.localeCompare(b, 'uk'));
  }, [catalog.data, selectedTradeChoice, selectedCategory, initial?.category]);

  const submitting = create.isPending || update.isPending;

  const onSubmit = handleSubmit(async (v) => {
    const customTradeId = parseCustomTradeKey(v.tradeChoice as TradeKey);
    const req: CatalogItemRequest = {
      name: v.name.trim(),
      type: v.type,
      unit: v.unit,
      // Picked from the list, or typed in when nothing was picked; blank in both means no category.
      category: (v.category.trim() || v.newCategory.trim()) || undefined,
      // A custom trade wins over any system trade sent alongside it (forced to OTHER server-side).
      trade: customTradeId ? undefined : (v.tradeChoice as Trade),
      customTradeId: customTradeId ?? undefined,
      defaultPrice: parsePrice(v.defaultPrice),
    };
    try {
      if (isEdit && initial) {
        await update.mutateAsync({ id: initial.id, req });
        toast.success(t('estimate.saved'));
      } else {
        await create.mutateAsync(req);
        toast.success(t('catalog.savedToCatalog'));
      }
      onDone();
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  });

  const onDelete = async () => {
    if (!initial) return;
    try {
      await del.mutateAsync(initial.id);
      toast.success(t('estimate.deleted'));
      onDone();
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  return (
    <>
      <form noValidate onSubmit={onSubmit} className="space-y-4">
        <FormField label={t('estimate.itemName')} htmlFor="ci-name" required error={errors.name?.message}>
          <Input id="ci-name" invalid={Boolean(errors.name)} {...register('name')} />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label={t('estimate.type')} htmlFor="ci-type" required error={errors.type?.message}>
            <Select id="ci-type" invalid={Boolean(errors.type)} {...register('type')}>
              {ITEM_TYPE_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {t('itemType.' + value)}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label={t('estimate.unit')} htmlFor="ci-unit" required error={errors.unit?.message}>
            <Select id="ci-unit" invalid={Boolean(errors.unit)} {...register('unit')}>
              {UNIT_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {t('unitOptions.' + value)}
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        <FormField
          label={t('estimate.category')}
          htmlFor="ci-category"
          error={errors.category?.message ?? errors.newCategory?.message}
        >
          <Select id="ci-category" invalid={Boolean(errors.category)} {...register('category')}>
            <option value="">{t('catalog.noCategory')}</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          {/* Nothing picked → offer to name one. Kept visible rather than hidden behind another
              control: on a phone an extra tap to reveal a field is a tap most masters never make,
              and «Без категорії» is a perfectly good final answer if they leave it empty. */}
          {!selectedCategory && (
            <Input
              id="ci-category-new"
              className="mt-2"
              placeholder={t('catalog.categoryNewPlaceholder')}
              invalid={Boolean(errors.newCategory)}
              {...register('newCategory')}
            />
          )}
        </FormField>

        {showTrade && (
          <FormField label={t('catalog.tradeLabel')} htmlFor="ci-trade">
            <Select id="ci-trade" {...register('tradeChoice')}>
              {tradeOptions.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </FormField>
        )}

        <FormField
          label={t('catalog.priceLabel')}
          htmlFor="ci-price"
          required
          error={errors.defaultPrice?.message}
        >
          <Input
            id="ci-price"
            inputMode="decimal"
            placeholder="0"
            invalid={Boolean(errors.defaultPrice)}
            {...register('defaultPrice')}
          />
        </FormField>

        <div className="flex gap-2 pt-1">
          {isEdit && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmOpen(true)}
              className="text-danger hover:bg-danger-soft"
            >
              {t('common.delete')}
            </Button>
          )}
          <Button type="submit" fullWidth loading={submitting}>
            {isEdit ? t('common.save') : t('common.add')}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirmOpen}
        title={t('catalog.deleteTitle')}
        message={t('catalog.deleteMessage', { name: initial?.name ?? '' })}
        loading={del.isPending}
        onConfirm={onDelete}
        onClose={() => setConfirmOpen(false)}
      />
    </>
  );
}
