import { z } from 'zod';
import { decimalString } from '@/lib/decimal.ts';

/**
 * Manual estimate line item — also used for editing an existing item
 * (saveToCatalog is simply ignored / hidden in edit mode).
 */
export const itemFormSchema = z.object({
  type: z.enum(['WORK', 'MATERIAL']),
  name: z.string().min(1, 'Введіть назву').max(255, 'Занадто довга назва'),
  category: z.string().max(100, 'Занадто довга категорія'),
  unit: z.enum(['M2', 'M', 'LINEAR_METER', 'PIECE', 'KG', 'HOUR', 'SET']),
  quantity: decimalString('Введіть кількість'),
  unitPrice: decimalString('Введіть ціну'),
  saveToCatalog: z.boolean(),
});

export type ItemFormValues = z.infer<typeof itemFormSchema>;
