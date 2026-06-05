import { z } from 'zod';
import i18n from '@/lib/i18n.ts';

export const TRADE_VALUES = [
  'ELECTRICAL',
  'PLUMBING',
  'TILING',
  'GENERAL',
  'OTHER',
] as const satisfies readonly string[];

export const registerSchema = z.object({
  email: z
    .string()
    .min(1, i18n.t('validation.enterEmail'))
    .email(i18n.t('validation.invalidEmail'))
    .max(255, i18n.t('validation.emailTooLong')),
  password: z
    .string()
    .min(8, i18n.t('validation.passwordTooShort'))
    .max(100, i18n.t('validation.passwordTooLong')),
  fullName: z
    .string()
    .min(1, i18n.t('validation.enterFullName'))
    .max(255, i18n.t('validation.valueTooLong')),
  trades: z
    .array(z.enum(TRADE_VALUES))
    .min(1, i18n.t('validation.chooseTrade')),
  phone: z
    .string()
    .min(5, i18n.t('validation.enterPhone'))
    .max(50, i18n.t('validation.valueTooLong')),
  companyName: z
    .string()
    .min(1, i18n.t('validation.enterCompanyName'))
    .max(255, i18n.t('validation.valueTooLong')),
});

export type RegisterFormValues = z.infer<typeof registerSchema>;
