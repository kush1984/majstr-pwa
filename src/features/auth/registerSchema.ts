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
  'METAL',
  'GENERAL',
  'OTHER',
] as const satisfies readonly string[];

export const registerSchema = z
  .object({
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
    // May be empty — isTradeChosen (below) only requires system OR custom, not specifically
    // a system trade. A master can rely entirely on a self-invented one.
    trades: z.array(z.enum(TRADE_VALUES)),
    // Master-invented trade names, collected locally and created alongside the account on
    // submit (the same flow ProfileEditModal offers post-registration, just reachable here
    // too — there's no account yet to attach them to individually).
    customTrades: z.array(z.string().trim().min(1).max(100)).default([]),
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
  })
  .superRefine((values, ctx) => {
    if (values.trades.length === 0 && values.customTrades.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: i18n.t('validation.chooseTrade'),
        path: ['trades'],
      });
    }
  });

export type RegisterFormValues = z.infer<typeof registerSchema>;
