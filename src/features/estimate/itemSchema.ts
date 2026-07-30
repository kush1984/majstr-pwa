import { z } from 'zod';
import { UNITS } from '@/api/types.ts';
import i18n from '@/lib/i18n.ts';
import { decimalString } from '@/lib/decimal.ts';

/**
 * Manual estimate line item — also used for editing an existing item
 * (saveToCatalog is simply ignored / hidden in edit mode).
 */
export const itemFormSchema = z.object({
  type: z.enum(['WORK', 'MATERIAL']),
  name: z
    .string()
    .min(1, i18n.t('validation.enterName'))
    .max(255, i18n.t('validation.nameTooLong')),
  category: z.string().max(100, i18n.t('validation.categoryTooLongShort')),
  unit: z.enum(UNITS),
  quantity: decimalString(i18n.t('validation.enterQuantity')),
  unitPrice: decimalString(i18n.t('validation.enterPrice')),
  saveToCatalog: z.boolean(),
});

export type ItemFormValues = z.infer<typeof itemFormSchema>;
