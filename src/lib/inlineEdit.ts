import i18n from '@/lib/i18n.ts';
import { toast } from '@/hooks/useToast.ts';
import { roundMoney, roundQuantity } from '@/lib/decimal.ts';

/**
 * «Що видно в рядку — редагується в рядку. Діалог — для решти.» The rules every inline cell shares,
 * kept out of the components so they are one definition (and testable without a DOM).
 */

/** Money is stored at scale 2, a quantity (and a «%» line's percent) at scale 3 — `numeric(15,2)` /
 *  `numeric(15,3)` on the server. */
export type InlineNumberKind = 'money' | 'quantity' | 'percent';

const SCALE: Record<InlineNumberKind, number> = { money: 2, quantity: 3, percent: 3 };

export type ParsedNumber = { ok: true; value: number } | { ok: false };

/**
 * Read what the master typed. EMPTY is 0 (and is saved — owner ruling, 2026-10-26); a comma or a
 * dot is the decimal point; spaces, non-breaking spaces and apostrophes are grouping. A minus, a
 * letter, an exponent or more decimals than the column holds is refused — a figure nobody typed
 * may never reach a document (review P-35).
 */
export function parseInlineNumber(raw: string, kind: InlineNumberKind): ParsedNumber {
  const s = raw.trim().replace(/[\s']/g, '');
  if (s === '') return { ok: true, value: 0 };
  const scale = SCALE[kind];
  const re = new RegExp(`^\\+?(\\d{1,12}([.,]\\d{0,${scale}})?|[.,]\\d{1,${scale}})$`);
  if (!re.test(s)) return { ok: false };
  const n = Number(s.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return { ok: false };
  return { ok: true, value: kind === 'money' ? roundMoney(n) : roundQuantity(n) };
}

const grouped = (scale: number) =>
  new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: scale });
const FORMATTERS: Record<InlineNumberKind, Intl.NumberFormat> = {
  money: new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  quantity: grouped(3),
  percent: grouped(3),
};

/** «1 234,50» — what the cell SHOWS: Ukrainian grouping, a comma, money always with kopecks. */
export function formatInlineNumber(value: number, kind: InlineNumberKind): string {
  const n = kind === 'money' ? roundMoney(value) || 0 : roundQuantity(value) || 0;
  // Intl writes U+00A0 between thousands; a plain space reads the same and copies cleanly.
  return FORMATTERS[kind].format(n).replace(/\s/g, ' ');
}

/** «1234,5» — what the cell starts EDITING from: no grouping (the cursor lands inside digits), the
 *  same comma, and no trailing zeros to delete first. */
export function editableInlineNumber(value: number, kind: InlineNumberKind): string {
  const n = kind === 'money' ? roundMoney(value) || 0 : roundQuantity(value) || 0;
  return String(n).replace('.', ',');
}

/** Whether two numbers are the same at the column's scale — an unchanged cell sends nothing. */
export function sameInlineNumber(a: number, b: number, kind: InlineNumberKind): boolean {
  const scale = SCALE[kind];
  return Math.round(a * 10 ** scale) === Math.round(b * 10 ** scale);
}

/** A typed name: trimmed, and EMPTY means «keep the old one» (no error, no request). */
export function normalizeInlineText(raw: string): string | null {
  const s = raw.trim();
  return s === '' ? null : s;
}

let lastUndoToast: number | null = null;

/**
 * «Збережено · Скасувати», 5 s. Only the LAST change is undoable: a new save replaces the previous
 * toast, so its «Скасувати» cannot roll back something the master no longer sees.
 */
export function toastUndoable(message: string, undo: () => void): void {
  if (lastUndoToast !== null) toast.dismiss(lastUndoToast);
  const id = toast.success(message, {
    ttlMs: 5000,
    action: {
      label: i18n.t('inline.undo'),
      onClick: () => {
        if (lastUndoToast === id) lastUndoToast = null;
        undo();
      },
    },
  });
  lastUndoToast = id;
}

/** Test seam: forget the remembered toast between cases. */
export function resetUndoToastForTests(): void {
  lastUndoToast = null;
}
