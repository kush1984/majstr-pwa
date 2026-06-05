import { z } from 'zod';
import i18n from '@/lib/i18n.ts';

export const loginSchema = z.object({
  email: z
    .string()
    .min(1, i18n.t('validation.enterEmail'))
    .email(i18n.t('validation.invalidEmail')),
  password: z.string().min(1, i18n.t('validation.enterPassword')),
});

export type LoginFormValues = z.infer<typeof loginSchema>;
