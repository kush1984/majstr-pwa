import { z } from 'zod';
import type { ItemType, Unit } from '@/api/types.ts';

export const ITEM_TYPE_OPTIONS: { value: ItemType; label: string }[] = [
  { value: 'WORK', label: 'Робота' },
  { value: 'MATERIAL', label: 'Матеріал' },
];

export const UNIT_OPTIONS: { value: Unit; label: string }[] = [
  { value: 'M2', label: 'м² (метр квадратний)' },
  { value: 'M', label: 'м (метр)' },
  { value: 'PIECE', label: 'шт (штука)' },
  { value: 'KG', label: 'кг (кілограм)' },
  { value: 'HOUR', label: 'год (година)' },
  { value: 'SET', label: 'компл. (комплект)' },
];

/**
 * Price is kept as a string in the form (accepts comma or dot) and parsed to a
 * number only when calling the API — avoids the NaN/coercion friction of
 * number inputs. The backend is the source of truth for money.
 */
const priceString = z
  .string()
  .min(1, 'Введіть ціну')
  .refine((s) => {
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) && n > 0;
  }, 'Ціна має бути більше 0');

export const catalogItemSchema = z.object({
  name: z.string().min(1, 'Введіть назву').max(255, 'Занадто довга назва'),
  type: z.enum(['WORK', 'MATERIAL'], { message: 'Оберіть тип' }),
  unit: z.enum(['M2', 'M', 'PIECE', 'KG', 'HOUR', 'SET'], { message: 'Оберіть одиницю' }),
  category: z.string().max(100, 'Занадто довга назва категорії'),
  defaultPrice: priceString,
});

export type CatalogItemFormValues = z.infer<typeof catalogItemSchema>;

/** "1 234,50" / "1234.5" → 1234.5, rounded to kopecks. */
export function parsePrice(s: string): number {
  return Math.round(Number(s.replace(',', '.')) * 100) / 100;
}
