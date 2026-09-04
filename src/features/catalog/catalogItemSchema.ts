import { z } from 'zod';
import i18n from '@/lib/i18n.ts';
import { UNITS } from '@/api/types.ts';
import type { ItemType, Unit } from '@/api/types.ts';

/** Option value lists; labels are rendered via i18n (`itemType.*` / `unitOptions.*`). */
export const ITEM_TYPE_OPTIONS: readonly ItemType[] = ['WORK', 'MATERIAL'];

export const UNIT_OPTIONS: readonly Unit[] = UNITS;

/**
 * Price is kept as a string in the form (accepts comma or dot) and parsed to a
 * number only when calling the API — avoids the NaN/coercion friction of
 * number inputs. The backend is the source of truth for money.
 */
const priceString = z
  .string()
  .min(1, i18n.t('validation.enterPrice'))
  .refine((s) => {
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) && n > 0;
  }, i18n.t('validation.priceTooLow'));

export const catalogItemSchema = z.object({
  name: z
    .string()
    .min(1, i18n.t('validation.enterName'))
    .max(255, i18n.t('validation.nameTooLong')),
  type: z.enum(['WORK', 'MATERIAL'], { message: i18n.t('validation.chooseType') }),
  unit: z.enum(UNITS, {
    message: i18n.t('validation.chooseUnit'),
  }),
  // The form offers a dropdown of the trade's existing categories; `newCategory` is the free
  // text shown when nothing is picked, so a master can name one that does not exist yet. Exactly
  // one of the two ends up on the request (see CatalogItemForm.onSubmit).
  category: z.string().max(100, i18n.t('validation.categoryTooLong')),
  newCategory: z.string().max(100, i18n.t('validation.categoryTooLong')),
  // Always a trade — "no specific trade" is OTHER ("Інше"), the single catch-all. Either a
  // system Trade literal or `custom:<uuid>` for a master-invented trade (see tradeKey.ts).
  tradeChoice: z.string().min(1),
  defaultPrice: priceString,
});

export type CatalogItemFormValues = z.infer<typeof catalogItemSchema>;

/** "1 234,50" / "1234.5" → 1234.5, rounded to kopecks. */
export function parsePrice(s: string): number {
  return Math.round(Number(s.replace(',', '.')) * 100) / 100;
}
