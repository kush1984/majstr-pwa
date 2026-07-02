import { z } from 'zod';
import i18n from '@/lib/i18n.ts';

export const TRADE_VALUES = [
  'ELECTRICAL',
  'PLUMBING',
  'TILING',
  'BUILDER',
  'PAINTER',
  'DRYWALL',
  'FLOORING',
  'DEMOLITION',
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
  // Explicit privacy-policy consent — submit is blocked until ticked.
  consent: z.boolean().refine((v) => v, { message: i18n.t('validation.consentRequired') }),
  // Optional community promo code (e.g. LIGA) — sets the referral source. Never
  // required; a plain registration leaves it empty and is attributed DIRECT.
  promoCode: z.string().max(40).optional(),
});

export type RegisterFormValues = z.infer<typeof registerSchema>;
