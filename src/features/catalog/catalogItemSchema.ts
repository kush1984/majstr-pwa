import { z } from 'zod';
import i18n from '@/lib/i18n.ts';
import { TRADE_VALUES } from '@/features/auth/registerSchema.ts';
import type { ItemType, Unit } from '@/api/types.ts';

/** Option value lists; labels are rendered via i18n (`itemType.*` / `unitOptions.*`). */
export const ITEM_TYPE_OPTIONS: readonly ItemType[] = ['WORK', 'MATERIAL'];

export const UNIT_OPTIONS: readonly Unit[] = [
  'M2',
  'M',
  'LINEAR_METER',
  'PIECE',
  'KG',
  'HOUR',
  'SET',
  'M3',
  'T',
  'POINT',
  'PERCENT',
  'KM',
];

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
  unit: z.enum(['M2', 'M', 'LINEAR_METER', 'PIECE', 'KG', 'HOUR', 'SET', 'M3', 'T', 'POINT', 'PERCENT', 'KM'], {
    message: i18n.t('validation.chooseUnit'),
  }),
  category: z.string().max(100, i18n.t('validation.categoryTooLong')),
  // Always a trade — "no specific trade" is OTHER ("Інше"), the single catch-all.
  trade: z.enum(TRADE_VALUES),
  defaultPrice: priceString,
});

export type CatalogItemFormValues = z.infer<typeof catalogItemSchema>;

/** "1 234,50" / "1234.5" → 1234.5, rounded to kopecks. */
export function parsePrice(s: string): number {
  return Math.round(Number(s.replace(',', '.')) * 100) / 100;
}
