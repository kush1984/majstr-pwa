import { z } from 'zod';

/** "1 234,5" / "1234.5" → 1234.5 (up to 3 decimals, matching backend quantity). */
export function parseDecimal(s: string): number {
  return Math.round(Number(s.replace(',', '.').replace(/\s/g, '')) * 1000) / 1000;
}

/** Zod string field that must parse to a positive number (comma or dot). */
export function decimalString(emptyMessage: string) {
  return z
    .string()
    .min(1, emptyMessage)
    .refine((s) => {
      const n = Number(s.replace(',', '.').replace(/\s/g, ''));
      return Number.isFinite(n) && n > 0;
    }, 'Значення має бути більше 0');
}
