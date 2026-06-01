import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Input } from '@/components/Input.tsx';
import { Select } from '@/components/Select.tsx';
import { FormField } from '@/components/FormField.tsx';
import { Button } from '@/components/Button.tsx';
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
  submitLabel,
  submitting,
  onSubmit,
  onDelete,
  deleting = false,
}: {
  initial?: EstimateItemResponse | null;
  showSaveToCatalog?: boolean;
  submitLabel: string;
  submitting: boolean;
  onSubmit: (req: EstimateItemRequest, saveToCatalog: boolean) => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const categories = useCatalogCategories();
  const {
    register,
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
          saveToCatalog: false,
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
      <FormField label="Назва" htmlFor="it-name" required error={errors.name?.message}>
        <Input id="it-name" invalid={Boolean(errors.name)} {...register('name')} />
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Тип" htmlFor="it-type" required error={errors.type?.message}>
          <Select id="it-type" invalid={Boolean(errors.type)} {...register('type')}>
            {ITEM_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Одиниця" htmlFor="it-unit" required error={errors.unit?.message}>
          <Select id="it-unit" invalid={Boolean(errors.unit)} {...register('unit')}>
            {UNIT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <FormField label="Категорія" htmlFor="it-category" error={errors.category?.message}>
        <Input
          id="it-category"
          list="it-category-list"
          placeholder="Напр. Демонтаж, Укладка"
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
        <FormField label="Кількість" htmlFor="it-qty" required error={errors.quantity?.message}>
          <Input
            id="it-qty"
            inputMode="decimal"
            placeholder="0"
            invalid={Boolean(errors.quantity)}
            {...register('quantity')}
          />
        </FormField>
        <FormField label="Ціна за од., ₴" htmlFor="it-price" required error={errors.unitPrice?.message}>
          <Input
            id="it-price"
            inputMode="decimal"
            placeholder="0"
            invalid={Boolean(errors.unitPrice)}
            {...register('unitPrice')}
          />
        </FormField>
      </div>

      {showSaveToCatalog && (
        <label className="flex items-center gap-2.5 text-sm text-secondary">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border text-brand focus:ring-brand"
            {...register('saveToCatalog')}
          />
          Зберегти позицію в каталог
        </label>
      )}

      <div className="flex gap-2 pt-1">
        {onDelete && (
          <Button
            type="button"
            variant="ghost"
            loading={deleting}
            onClick={onDelete}
            className="text-danger hover:bg-danger-soft"
          >
            Видалити
          </Button>
        )}
        <Button type="submit" fullWidth loading={submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
