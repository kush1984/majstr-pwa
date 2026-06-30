import { useState } from 'react';
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
import { TRADE_VALUES } from '@/features/auth/registerSchema.ts';
import type { CatalogItemRequest, CatalogItemResponse, Trade } from '@/api/types.ts';
import {
  catalogItemSchema,
  parsePrice,
  ITEM_TYPE_OPTIONS,
  UNIT_OPTIONS,
  type CatalogItemFormValues,
} from './catalogItemSchema.ts';
import {
  useCatalogCategories,
  useCreateCatalogItem,
  useDeleteCatalogItem,
  useUpdateCatalogItem,
} from './useCatalog.ts';

/**
 * Create / edit a catalog item. Rendered inside a Modal by the page.
 * `initial` null → create mode; an item → edit mode (with a delete action).
 */
export function CatalogItemForm({
  initial,
  defaultTrade,
  onDone,
}: {
  initial: CatalogItemResponse | null;
  /** Pre-select this trade on create (the catalog's active trade filter). */
  defaultTrade?: Trade;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const isEdit = Boolean(initial);
  const create = useCreateCatalogItem();
  const update = useUpdateCatalogItem();
  const del = useDeleteCatalogItem();
  const categories = useCatalogCategories();
  const { data: me } = useMe();
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Only worth choosing a trade when the master has more than one.
  const showTrade = (me?.trades.length ?? 0) >= 2;
  // Always offer the item's CURRENT trade as an option, even if the master no
  // longer works in it (removed from profile) — otherwise editing the item would
  // silently fall back to the first option and wipe its trade on save.
  const tradeOptions = (() => {
    const opts = [...(me?.trades ?? [])];
    if (initial?.trade && !opts.includes(initial.trade)) opts.unshift(initial.trade);
    return opts.length > 0 ? opts : TRADE_VALUES;
  })();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CatalogItemFormValues>({
    resolver: zodResolver(catalogItemSchema),
    defaultValues: initial
      ? {
          name: initial.name,
          type: initial.type,
          unit: initial.unit,
          category: initial.category ?? '',
          trade: initial.trade ?? '',
          defaultPrice: String(initial.defaultPrice),
        }
      : { name: '', type: 'WORK', unit: 'PIECE', category: '', trade: defaultTrade ?? '', defaultPrice: '' },
  });

  const submitting = create.isPending || update.isPending;

  const onSubmit = handleSubmit(async (v) => {
    const req: CatalogItemRequest = {
      name: v.name.trim(),
      type: v.type,
      unit: v.unit,
      category: v.category.trim() || undefined,
      // When the trade picker is hidden (single-trade master), preserve the
      // existing trade rather than risk overwriting it from a stale form value.
      trade: showTrade ? v.trade || null : initial?.trade ?? null,
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
          error={errors.category?.message}
          hint={t('catalog.categoryHint')}
        >
          <Input
            id="ci-category"
            list="ci-category-list"
            invalid={Boolean(errors.category)}
            {...register('category')}
          />
          <datalist id="ci-category-list">
            {(categories.data ?? []).map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </FormField>

        {showTrade && (
          <FormField label={t('catalog.tradeLabel')} htmlFor="ci-trade">
            <Select id="ci-trade" {...register('trade')}>
              <option value="">{t('catalog.otherTrade')}</option>
              {tradeOptions.map((tr) => (
                <option key={tr} value={tr}>
                  {t('trades.' + tr)}
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
