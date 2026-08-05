import { useState } from 'react';
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
import { useMe } from '@/features/auth/useMe.ts';
import { formatMoney } from '@/lib/format.ts';
import { cn } from '@/lib/cn.ts';
import type { EstimateItemRequest, EstimateItemResponse, PercentBaseKind } from '@/api/types.ts';
import { itemFormSchema, type ItemFormValues } from './itemSchema.ts';
import { MeasureCalculator } from './MeasureCalculator.tsx';
import { MeasurementPicker } from '@/features/measurements/MeasurementPicker.tsx';

/**
 * Manual line-item form. Used both for adding a new item and editing one.
 * `onSubmit` hands back a ready EstimateItemRequest plus the saveToCatalog flag.
 */
export function ItemForm({
  initial,
  siblings = [],
  estimateTotal = 0,
  objectId,
  showSaveToCatalog = false,
  enableAutocomplete = false,
  submitLabel,
  submitting,
  onSubmit,
  onDelete,
  deleting = false,
}: {
  initial?: EstimateItemResponse | null;
  /**
   * The estimate's other lines — the base picker for a «%» line.
   *
   * <p>ORDINARY lines only reach the picker (filtered below). That filter IS the cycle protection:
   * a percentage can never point at a percentage, so no chain of them can close on itself, and
   * there is no graph to walk.</p>
   */
  siblings?: EstimateItemResponse[];
  /** The estimate's current total — shown live under a «% від усього кошторису» line. */
  estimateTotal?: number;
  /** The object (project) id — enables "Вибрати з замірів" when it has measurements.
   *  Pass undefined for a SIGNED estimate (measurements can't change a signed line). */
  objectId?: string;
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
  const { data: me } = useMe();
  const isPro = (me?.plan ?? 'FREE') !== 'FREE'; // measurements are PRO — only then offer the picker
  const [calcOpen, setCalcOpen] = useState(false);
  // Measurement substitution (Stage 2): selection memory + manual-edit priority.
  const [measurementRefs, setMeasurementRefs] = useState<string[]>(initial?.measurementRefs ?? []);
  const [quantityManual, setQuantityManual] = useState<boolean>(initial?.quantityManual ?? false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // «%» is a share OF something. Default MANUAL — the shape «%» already had, a sum in the price
  // field — so a line that never picks a base still behaves the way it reads.
  const [baseKind, setBaseKind] = useState<PercentBaseKind>(initial?.percentBaseKind ?? 'MANUAL');
  const [baseItemId, setBaseItemId] = useState<string | null>(initial?.percentBaseItemId ?? null);
  // A POSITION «%» line must name the position it's a share of — surfaced inline, not swallowed.
  const [baseError, setBaseError] = useState(false);
  const {
    register,
    control,
    setValue,
    setError,
    watch,
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
          // A 0 (e.g. an imported line the master hasn't filled) opens EMPTY, not "0",
          // so there's nothing to erase on mobile. Save still requires a positive number
          // (itemFormSchema → decimalString: empty and 0 are both rejected).
          quantity: initial.quantity ? String(initial.quantity) : '',
          unitPrice: initial.unitPrice ? String(initial.unitPrice) : '',
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

  const qtyReg = register('quantity');

  const watchedUnit = watch('unit');
  const isPercent = watchedUnit === 'PERCENT';
  // The «Порахувати з розмірів» calculator only makes sense for a length/area/volume unit — for
  // штука / кг / % / точка a size calc means nothing, so the tool is hidden there entirely.
  const canMeasure = watchedUnit === 'M' || watchedUnit === 'M2'
    || watchedUnit === 'LINEAR_METER' || watchedUnit === 'M3';
  const pct = parseDecimal(watch('quantity')) || 0;
  const manualBase = parseDecimal(watch('unitPrice')) || 0;
  const baseLine = siblings.find((s) => s.id === baseItemId) ?? null;
  const baseAmount = baseKind === 'MANUAL'
    ? manualBase
    : baseKind === 'TOTAL'
      ? estimateTotal
      : (baseLine?.lineTotal ?? 0);
  const percentPreview = (() => {
    const result = formatMoney(Math.round(((baseAmount * pct) / 100) * 100) / 100);
    if (baseKind === 'MANUAL') {
      return t('estimate.percentPreviewManual', { pct, sum: formatMoney(manualBase), result });
    }
    if (baseKind === 'TOTAL') {
      return t('estimate.percentPreviewTotal', { pct, base: formatMoney(estimateTotal), result });
    }
    return baseLine
      ? t('estimate.percentPreviewItem', {
        pct, name: baseLine.name, base: formatMoney(baseLine.lineTotal), result,
      })
      : t('estimate.percentNoBaseYet');
  })();

  const submit = handleSubmit((v) => {
    // «%» validation the schema can't do — the base kind lives in component state, not the form.
    if (v.unit === 'PERCENT') {
      if (baseKind === 'MANUAL' && !(parseDecimal(v.unitPrice) > 0)) {
        setError('unitPrice', { message: t('validation.enterPrice') });
        return;
      }
      if (baseKind === 'POSITION' && !baseItemId) {
        setBaseError(true);
        return;
      }
    }
    const req: EstimateItemRequest = {
      type: v.type,
      name: v.name.trim(),
      category: v.category.trim() || undefined,
      unit: v.unit,
      quantity: parseDecimal(v.quantity),
      unitPrice: parseDecimal(v.unitPrice),
      measurementRefs: measurementRefs.length > 0 ? measurementRefs : undefined,
      quantityManual,
      // Only a percentage line records a base; anything else sends none, whatever is in state.
      percentBaseKind: v.unit === 'PERCENT' ? baseKind : undefined,
      percentBaseItemId: v.unit === 'PERCENT' && baseKind === 'POSITION' ? baseItemId : undefined,
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
        <FormField
          label={isPercent ? t('estimate.percentLabel') : t('estimate.quantity')}
          htmlFor="it-qty"
          required
          error={errors.quantity?.message}
        >
          <Input
            id="it-qty"
            inputMode="decimal"
            placeholder="0"
            invalid={Boolean(errors.quantity)}
            {...qtyReg}
            onChange={(e) => {
              void qtyReg.onChange(e); // keep react-hook-form in sync (its handler is async)
              setQuantityManual(true); // a hand-typed quantity is no longer a live measurement sum
            }}
          />
        </FormField>
        {/* A percentage of a LINE or of the TOTAL has no price of its own — the field would ask
            for a number that means nothing. Only «своя сума» keeps it, relabelled for what it is. */}
        {!isPercent || baseKind === 'MANUAL' ? (
          <FormField
            label={isPercent ? t('estimate.percentBaseSum') : t('estimate.unitPrice')}
            htmlFor="it-price"
            required
            error={errors.unitPrice?.message}
          >
            <Input
              id="it-price"
              inputMode="decimal"
              placeholder="0"
              invalid={Boolean(errors.unitPrice)}
              {...register('unitPrice')}
            />
          </FormField>
        ) : (
          <div />
        )}
      </div>

      {isPercent && (
        <div className="space-y-2 rounded-xl border border-border bg-surface-sunken p-3">
          <p className="text-xs font-semibold text-muted">{t('estimate.percentBase')}</p>
          <div className="flex flex-wrap gap-2">
            {(['MANUAL', 'POSITION', 'TOTAL'] as PercentBaseKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => {
                  setBaseKind(kind);
                  setBaseError(false);
                  // The price field is hidden for a non-MANUAL base — drop any sum left in it so a
                  // stale figure can't ride along on the request.
                  if (kind !== 'MANUAL') setValue('unitPrice', '');
                }}
                className={cn(
                  'min-h-[44px] rounded-xl border px-3 text-sm font-semibold',
                  baseKind === kind
                    ? 'border-brand bg-brand-soft/40 text-primary'
                    : 'border-border text-muted',
                )}
              >
                {t('estimate.percentBase' + (kind === 'MANUAL' ? 'Manual' : kind === 'POSITION' ? 'Item' : 'Total'))}
              </button>
            ))}
          </div>

          {baseKind === 'POSITION' && (
            <>
              <select
                value={baseItemId ?? ''}
                onChange={(e) => { setBaseItemId(e.target.value || null); setBaseError(false); }}
                className={cn(
                  'min-h-[44px] w-full rounded-xl border bg-surface px-3 text-sm text-primary',
                  baseError ? 'border-danger' : 'border-border',
                )}
              >
                <option value="">{t('estimate.percentNoBaseYet')}</option>
                {/* Percentage lines are NOT offered — that is what makes a cycle unbuildable. */}
                {siblings
                  .filter((s) => s.unit !== 'PERCENT' && s.id !== initial?.id)
                  .map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
              </select>
              {baseError && (
                <p className="text-xs text-danger">{t('estimate.percentPickBaseError')}</p>
              )}
            </>
          )}

          {/* The live figure, because a percentage the master cannot check is a percentage he will
              not trust — and the client is the one asked to sign it. */}
          <p className="text-sm font-semibold text-primary">{percentPreview}</p>

          {initial?.baseDetached && (
            <p className="text-xs text-amber">{t('estimate.percentReattach')}</p>
          )}
        </div>
      )}

      {canMeasure && (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <button
            type="button"
            onClick={() => { setCalcOpen((o) => !o); setPickerOpen(false); }}
            className="text-xs font-semibold text-brand"
          >
            📐 {t('estimate.measureCalc')}
          </button>
          {/* "Вибрати з замірів" — only when the object has measurements and the line is
              in a measurable unit (m² / м.пог). Hidden on a SIGNED estimate (objectId undefined). */}
          {objectId && isPro && (watch('unit') === 'M2' || watch('unit') === 'LINEAR_METER') && (
            <button
              type="button"
              onClick={() => { setPickerOpen((o) => !o); setCalcOpen(false); }}
              className="text-xs font-semibold text-brand"
            >
              📋 {t('measurePick.button')}
              {measurementRefs.length > 0 && (
                <span className="ml-1 text-muted">({measurementRefs.length})</span>
              )}
            </button>
          )}
        </div>
        {calcOpen && (
          <MeasureCalculator
            unit={watch('unit')}
            onApply={(q) => {
              setValue('quantity', String(q), { shouldValidate: true });
              setQuantityManual(true); // the single-line calc is a manual number, not object measurements
            }}
            onClose={() => setCalcOpen(false)}
          />
        )}
        {pickerOpen && objectId && (
          <MeasurementPicker
            objectId={objectId}
            unit={watch('unit')}
            selectedIds={measurementRefs}
            quantityManual={quantityManual}
            onApply={(ids, s) => {
              setMeasurementRefs(ids);
              setQuantityManual(false);
              setValue('quantity', String(s), { shouldValidate: true });
              setPickerOpen(false);
            }}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>
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
