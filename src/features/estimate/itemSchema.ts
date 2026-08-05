import { z } from 'zod';
import { UNITS } from '@/api/types.ts';
import i18n from '@/lib/i18n.ts';
import { decimalString } from '@/lib/decimal.ts';

/**
 * Manual estimate line item — also used for editing an existing item
 * (saveToCatalog is simply ignored / hidden in edit mode).
 */
export const itemFormSchema = z
  .object({
    type: z.enum(['WORK', 'MATERIAL']),
    name: z
      .string()
      .min(1, i18n.t('validation.enterName'))
      .max(255, i18n.t('validation.nameTooLong')),
    category: z.string().max(100, i18n.t('validation.categoryTooLongShort')),
    unit: z.enum(UNITS),
    quantity: decimalString(i18n.t('validation.enterQuantity')),
    // Validated conditionally below, NOT with decimalString: a «%» line's price field is a base
    // sum that only applies to the MANUAL base — for a POSITION/TOTAL base it is HIDDEN, so a
    // required-here rule would block submit on a field the master can't see (and silently, since
    // handleSubmit just doesn't fire). The MANUAL-sum requirement is enforced in ItemForm, where
    // the base kind (component state) is known.
    unitPrice: z.string(),
    saveToCatalog: z.boolean(),
  })
  .superRefine((val, ctx) => {
    if (val.unit === 'PERCENT') return; // «%» price handled in ItemForm
    if (val.unitPrice.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ['unitPrice'], message: i18n.t('validation.enterPrice'),
      });
      return;
    }
    const n = Number(val.unitPrice.replace(',', '.').replace(/\s/g, ''));
    if (!Number.isFinite(n) || n <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ['unitPrice'], message: i18n.t('validation.valueTooLow'),
      });
    }
  });

export type ItemFormValues = z.infer<typeof itemFormSchema>;
