import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/Input.tsx';
import { Select } from '@/components/Select.tsx';
import { FormField } from '@/components/FormField.tsx';
import { Button } from '@/components/Button.tsx';
import { CatalogAutocomplete } from './CatalogAutocomplete.tsx';
import { parseDecimal } from '@/lib/decimal.ts';
import {
  ITEM_TYPE_OPTIONS,
  UNIT_OPTIONS,
} from '@/features/catalog/catalogItemSchema.ts';
import { useCatalogCategories } from '@/features/catalog/useCatalog.ts';
import type { EstimateItemRequest, EstimateItemResponse } from '@/api/types.ts';
import { itemFormSchema, type ItemFormValues } from './itemSchema.ts';

/**
 * Manual line-item form. Used both for adding a new item and editing one.
 * `onSubmit` hands back a ready EstimateItemRequest plus the saveToCatalog flag.
 */
export function ItemForm({
  initial,
  showSaveToCatalog = false,
  enableAutocomplete = false,
  submitLabel,
  submitting,
  onSubmit,
  onDelete,
  deleting = false,
}: {
  initial?: EstimateItemResponse | null;
  showSaveToCatalog?: boolean;
  /** Turn the name field into a catalog type-ahead (add-new flow only). */
  enableAutocomplete?: boolean;
  submitLabel: string;
  submitting: boolean;
  onSubmit: (req: EstimateItemRequest, saveToCatalog: boolean) => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const { t } = useTranslation();
  const categories = useCatalogCategories();
  const {
    register,
    control,
    setValue,
    handleSubmit,
    formState: { errors },
  } = useForm<ItemFormValues>({
    resolver: zodResolver(itemFormSchema),
    defaultValues: initial
      ? {
          type: initial.type,
          name: initial.name,
          category: initial.category ?? '',
          unit: initial.unit,
          quantity: String(initial.quantity),
          unitPrice: String(initial.unitPrice),
          saveToCatalog: false,
        }
      : {
          type: 'WORK',
          name: '',
          category: '',
          unit: 'PIECE',
          quantity: '',
          unitPrice: '',
          // Self-filling catalog: a brand-new manual item defaults to being
          // saved back to the catalog so it's suggested next time.
          saveToCatalog: showSaveToCatalog,
        },
  });

  const submit = handleSubmit((v) => {
    const req: EstimateItemRequest = {
      type: v.type,
      name: v.name.trim(),
      category: v.category.trim() || undefined,
      unit: v.unit,
      quantity: parseDecimal(v.quantity),
      unitPrice: parseDecimal(v.unitPrice),
    };
    onSubmit(req, v.saveToCatalog);
  });

  return (
    <form noValidate onSubmit={submit} className="space-y-4">
      <FormField label={t('estimate.itemName')} htmlFor="it-name" required error={errors.name?.message}>
        {enableAutocomplete ? (
          <Controller
            control={control}
            name="name"
            render={({ field }) => (
              <CatalogAutocomplete
                id="it-name"
                value={field.value}
                onBlur={field.onBlur}
                invalid={Boolean(errors.name)}
                placeholder={t('estimate.itemNamePlaceholder')}
                onChange={field.onChange}
                onPick={(item) => {
                  field.onChange(item.name);
                  setValue('type', item.type, { shouldValidate: true });
                  setValue('unit', item.unit, { shouldValidate: true });
                  setValue('unitPrice', String(item.defaultPrice), { shouldValidate: true });
                  if (item.category) setValue('category', item.category);
                  // It's already in the catalog — don't re-save a duplicate.
                  setValue('saveToCatalog', false);
                }}
              />
            )}
          />
        ) : (
          <Input id="it-name" invalid={Boolean(errors.name)} {...register('name')} />
        )}
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label={t('estimate.type')} htmlFor="it-type" required error={errors.type?.message}>
          <Select id="it-type" invalid={Boolean(errors.type)} {...register('type')}>
            {ITEM_TYPE_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {t('itemType.' + value)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('estimate.unit')} htmlFor="it-unit" required error={errors.unit?.message}>
          <Select id="it-unit" invalid={Boolean(errors.unit)} {...register('unit')}>
            {UNIT_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {t('unitOptions.' + value)}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <FormField label={t('estimate.category')} htmlFor="it-category" error={errors.category?.message}>
        <Input
          id="it-category"
          list="it-category-list"
          placeholder={t('estimate.categoryPlaceholder')}
          invalid={Boolean(errors.category)}
          {...register('category')}
        />
        <datalist id="it-category-list">
          {(categories.data ?? []).map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label={t('estimate.quantity')} htmlFor="it-qty" required error={errors.quantity?.message}>
          <Input
            id="it-qty"
            inputMode="decimal"
            placeholder="0"
            invalid={Boolean(errors.quantity)}
            {...register('quantity')}
          />
        </FormField>
        <FormField label={t('estimate.unitPrice')} htmlFor="it-price" required error={errors.unitPrice?.message}>
          <Input
            id="it-price"
            inputMode="decimal"
            placeholder="0"
            invalid={Boolean(errors.unitPrice)}
            {...register('unitPrice')}
          />
        </FormField>
      </div>

      <div className="flex gap-2 pt-1">
        {onDelete && (
          <Button
            type="button"
            variant="ghost"
            loading={deleting}
            onClick={onDelete}
            className="text-danger hover:bg-danger-soft"
          >
            {t('common.delete')}
          </Button>
        )}
        <Button type="submit" fullWidth loading={submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
