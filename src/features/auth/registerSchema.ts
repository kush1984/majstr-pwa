import { z } from '@/lib/zod.ts';
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
  'DOORS_WINDOWS',
  'CLIMATE',
  'GENERAL',
  'OTHER',
] as const satisfies readonly string[];

/**
 * The door asks for two things (V190, registration friction round 2): email and password. Consent is
 * the button press itself, with the line under it naming the policy (no checkbox since 2026-11-15).
 * Trades are the first screen inside (`TradesOnboardingPage`), the name is asked before the first
 * document leaves (`SenderGate`), phone and company are optional for good.
 */
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
  // Optional community promo code (e.g. LIGA) — sets the referral source. Never
  // required; a plain registration leaves it empty and is attributed DIRECT.
  promoCode: z.string().max(40).optional(),
});

export type RegisterFormValues = z.infer<typeof registerSchema>;
