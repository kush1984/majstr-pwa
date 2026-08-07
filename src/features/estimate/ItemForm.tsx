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
   * The estimate's other lines — the base picker for a «%» line, AND the source of the
   * «% від кошторису» base (computed here, not passed in, so it always matches the server).
   *
   * <p>ORDINARY lines only reach the picker (filtered below). That filter IS the cycle protection:
   * a percentage can never point at a percentage, so no chain of them can close on itself, and
   * there is no graph to walk.</p>
   */
  siblings?: EstimateItemResponse[];
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
  // A line copied into a consolidated rollup — its amount is FROZEN (baseDetached, kind forced to
  // MANUAL server-side) and carries a provenance snapshot instead of a live base. The live
  // POSITION/TOTAL picker would be actively misleading here (there is no real base to point at,
  // and re-picking one would not do anything), so this renders a completely different, honest block.
  const isFrozen = Boolean(initial?.baseOriginLabel);
  // «%» is a share OF something: «Від позиції» (a markup on one line) or «Від кошторису» (a share of
  // the works- or materials-subtotal). Default POSITION — a legacy MANUAL/null line opens as POSITION
  // too (MANUAL is gone from the product for a LIVE line); a detached one keeps its frozen amount and
  // says so. A frozen (consolidated) line is always MANUAL — there is no picker to default into.
  const [baseKind, setBaseKind] = useState<PercentBaseKind>(
    isFrozen ? 'MANUAL' : initial?.percentBaseKind === 'TOTAL' ? 'TOTAL' : 'POSITION',
  );
  const [baseItemId, setBaseItemId] = useState<string | null>(initial?.percentBaseItemId ?? null);
  // A POSITION «%» line must name the position it's a share of — surfaced inline, not swallowed.
  const [baseError, setBaseError] = useState(false);
  // Sign of a «Від кошторису» percent, OR of a frozen consolidated line (which may just as well be
  // a discount). The field holds a POSITIVE magnitude; this +/− toggle carries the sign (the mobile
  // decimal keypad has no minus). «Від позиції» (a live one) is always a markup — no toggle there.
  // An existing line opens on the right side by reading the sign of its stored percent.
  const [percentMinus, setPercentMinus] = useState<boolean>(
    initial?.unit === 'PERCENT' && (initial.quantity ?? 0) < 0,
  );
  // Whether the sign toggle / a negative submitted percent applies — «Від кошторису» or frozen.
  const percentCanBeNegative = baseKind === 'TOTAL' || isFrozen;
  const {
    register,
    control,
    setValue,
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
          // (itemFormSchema → decimalString: empty and 0 are both rejected). A «%» line stores its
          // percent SIGNED; the field shows the magnitude and the toggle carries the sign.
          quantity: initial.quantity
            ? String(initial.unit === 'PERCENT' ? Math.abs(initial.quantity) : initial.quantity)
            : '',
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
  const watchedType = watch('type');
  // At most ONE «Від кошторису» per type: a markup AND a discount on the same works/materials is not a
  // real-world case and compounds confusingly. A second one is blocked; editing the existing one is
  // fine (it excludes itself).
  const sameTypeTotalExists = isPercent && baseKind === 'TOTAL' && siblings.some(
    (s) => s.id !== initial?.id
      && s.type === watchedType
      && s.unit === 'PERCENT'
      && (s.percentBaseKind ?? 'MANUAL') === 'TOTAL',
  );
  // The field is a positive magnitude; a «Від кошторису» (or frozen) line may carry a «−» sign
  // (a discount).
  const pct = (isPercent && percentCanBeNegative && percentMinus ? -1 : 1)
    * (parseDecimal(watch('quantity')) || 0);
  const baseLine = siblings.find((s) => s.id === baseItemId) ?? null;
  // «Від кошторису» base = the subtotal of every line of THIS line's type that is not itself a
  // «% від кошторису» — the exact rule EstimateMath uses server-side (a WORK percent measures works,
  // a MATERIAL percent materials, and neither compounds). Passing the full est.total instead made
  // the preview disagree with the saved line — the «косячок» the master spotted.
  const totalBase = siblings
    .filter((s) => s.type === watchedType
      && !(s.unit === 'PERCENT' && (s.percentBaseKind ?? 'MANUAL') === 'TOTAL'))
    .reduce((sum, s) => sum + (s.lineTotal ?? 0), 0);
  const baseAmount = baseKind === 'TOTAL' ? totalBase : (baseLine?.lineTotal ?? 0);
  const percentPreview = (() => {
    const result = formatMoney(Math.round(((baseAmount * pct) / 100) * 100) / 100);
    if (baseKind === 'TOTAL') {
      const scope = t(watchedType === 'WORK'
        ? 'estimate.percentScopeWorks' : 'estimate.percentScopeMaterials');
      return t('estimate.percentPreviewTotal', { pct, scope, base: formatMoney(totalBase), result });
    }
    return baseLine
      ? t('estimate.percentPreviewItem', {
        pct, name: baseLine.name, base: formatMoney(baseLine.lineTotal), result,
      })
      : t('estimate.percentNoBaseYet');
  })();

  const submit = handleSubmit((v) => {
    // «%» validation the schema can't do — the base kind lives in component state, not the form.
    if (v.unit === 'PERCENT' && baseKind === 'POSITION' && !baseItemId) {
      setBaseError(true);
      return;
    }
    if (v.unit === 'PERCENT' && baseKind === 'TOTAL' && sameTypeTotalExists) {
      return; // one «Від кошторису» per type — the inline warning explains why
    }
    const req: EstimateItemRequest = {
      type: v.type,
      name: v.name.trim(),
      category: v.category.trim() || undefined,
      unit: v.unit,
      // The field is a positive magnitude; a «Від кошторису» (or frozen) «−» makes the percent
      // negative (a discount). «Від позиції» is always a positive markup.
      quantity: isPercent && percentCanBeNegative && percentMinus
        ? -parseDecimal(v.quantity) : parseDecimal(v.quantity),
      // A LIVE «%» line has no price of its own — «Від позиції»/«Від кошторису» both measure
      // another sum. A FROZEN (MANUAL) line's price IS the base sum it was frozen against, and
      // stays directly editable — there is no live base to derive it from any more.
      unitPrice: isPercent ? (isFrozen ? parseDecimal(v.unitPrice) : 0) : parseDecimal(v.unitPrice),
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
        {/* A LIVE «%» line has no price of its own — «Від позиції»/«Від кошторису» both measure
            another sum, so the field would ask for a number that means nothing. A FROZEN
            (consolidated) line has no live base any more, so its price — the sum it was frozen
            against — becomes the one thing left to edit directly. */}
        {isPercent && !isFrozen ? (
          <div />
        ) : (
          <FormField
            label={isFrozen ? t('estimate.percentFrozenBase') : t('estimate.unitPrice')}
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
        )}
      </div>

      {isPercent && isFrozen && (
        // Frozen (consolidated) line: no live base picker — there is nothing left to point at,
        // and re-picking one would silently do nothing. Just the honest provenance snapshot;
        // percent and base sum above are still directly editable (they're what's actually stored).
        <div className="space-y-2 rounded-xl border border-amber/40 bg-amber/5 p-3">
          <p className="text-xs font-semibold text-amber">{t('estimate.percentFrozenTitle')}</p>
          <p className="text-sm text-primary">{initial?.baseOriginLabel}</p>
          <p className="text-xs text-muted">{t('estimate.percentFrozenHint')}</p>
        </div>
      )}

      {isPercent && !isFrozen && (
        <div className="space-y-2 rounded-xl border border-border bg-surface-sunken p-3">
          <p className="text-xs font-semibold text-muted">{t('estimate.percentBase')}</p>
          <div className="flex flex-wrap gap-2">
            {(['POSITION', 'TOTAL'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => { setBaseKind(kind); setBaseError(false); }}
                className={cn(
                  'min-h-[44px] rounded-xl border px-3 text-sm font-semibold',
                  baseKind === kind
                    ? 'border-brand bg-brand-soft/40 text-primary'
                    : 'border-border text-muted',
                )}
              >
                {t(kind === 'POSITION' ? 'estimate.percentBaseItem' : 'estimate.percentBaseTotal')}
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

          {/* «Від кошторису» may add to or take off the subtotal — the master picks the sign, no
              «націнка/знижка» wording, just + / −. «Від позиції» is always a markup, so no toggle. */}
          {baseKind === 'TOTAL' && (
            <div className="flex gap-1 rounded-xl bg-surface p-1">
              {[false, true].map((minus) => (
                <button
                  key={String(minus)}
                  type="button"
                  onClick={() => setPercentMinus(minus)}
                  className={cn(
                    'flex-1 rounded-lg py-2 text-base font-bold transition-colors',
                    percentMinus === minus ? 'bg-brand-soft/40 text-primary shadow-card' : 'text-muted',
                  )}
                >
                  {minus ? '−' : '+'}
                </button>
              ))}
            </div>
          )}

          {baseKind === 'TOTAL' && sameTypeTotalExists && (
            <p className="text-xs text-danger">
              {t('estimate.percentTotalDuplicate', {
                scope: t(watchedType === 'WORK'
                  ? 'estimate.percentScopeWorks' : 'estimate.percentScopeMaterials'),
              })}
            </p>
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
        <Button type="submit" fullWidth loading={submitting} disabled={sameTypeTotalExists}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
