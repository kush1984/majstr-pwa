import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Select } from '@/components/Select.tsx';
import { FormField } from '@/components/FormField.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import type { CatalogItemRequest, CatalogItemResponse } from '@/api/types.ts';
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
  onDone,
}: {
  initial: CatalogItemResponse | null;
  onDone: () => void;
}) {
  const isEdit = Boolean(initial);
  const create = useCreateCatalogItem();
  const update = useUpdateCatalogItem();
  const del = useDeleteCatalogItem();
  const categories = useCatalogCategories();
  const [confirmOpen, setConfirmOpen] = useState(false);

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
          defaultPrice: String(initial.defaultPrice),
        }
      : { name: '', type: 'WORK', unit: 'PIECE', category: '', defaultPrice: '' },
  });

  const submitting = create.isPending || update.isPending;

  const onSubmit = handleSubmit(async (v) => {
    const req: CatalogItemRequest = {
      name: v.name.trim(),
      type: v.type,
      unit: v.unit,
      category: v.category.trim() || undefined,
      defaultPrice: parsePrice(v.defaultPrice),
    };
    try {
      if (isEdit && initial) {
        await update.mutateAsync({ id: initial.id, req });
        toast.success('Збережено');
      } else {
        await create.mutateAsync(req);
        toast.success('Додано в каталог');
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
      toast.success('Видалено');
      onDone();
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  return (
    <>
      <form noValidate onSubmit={onSubmit} className="space-y-4">
        <FormField label="Назва" htmlFor="ci-name" required error={errors.name?.message}>
          <Input id="ci-name" invalid={Boolean(errors.name)} {...register('name')} />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Тип" htmlFor="ci-type" required error={errors.type?.message}>
            <Select id="ci-type" invalid={Boolean(errors.type)} {...register('type')}>
              {ITEM_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label="Одиниця" htmlFor="ci-unit" required error={errors.unit?.message}>
            <Select id="ci-unit" invalid={Boolean(errors.unit)} {...register('unit')}>
              {UNIT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        <FormField
          label="Категорія"
          htmlFor="ci-category"
          error={errors.category?.message}
          hint="Напр. Електрика, Плитка, Демонтаж"
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

        <FormField
          label="Ціна за одиницю, ₴"
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
              Видалити
            </Button>
          )}
          <Button type="submit" fullWidth loading={submitting}>
            {isEdit ? 'Зберегти' : 'Додати'}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirmOpen}
        title="Видалити позицію?"
        message={`«${initial?.name}» буде видалено з каталогу. Уже додані в кошториси позиції залишаться.`}
        loading={del.isPending}
        onConfirm={onDelete}
        onClose={() => setConfirmOpen(false)}
      />
    </>
  );
}
