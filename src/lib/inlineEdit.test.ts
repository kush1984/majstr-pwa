import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/lib/i18n.ts';
import {
  editableInlineNumber,
  formatInlineNumber,
  normalizeInlineText,
  parseInlineNumber,
  resetUndoToastForTests,
  sameInlineNumber,
  toastUndoable,
} from './inlineEdit.ts';
import { toast } from '@/hooks/useToast.ts';

describe('parseInlineNumber', () => {
  it('reads a grouped number with a comma and a plain one with a dot', () => {
    expect(parseInlineNumber('1 234,5', 'money')).toEqual({ ok: true, value: 1234.5 });
    expect(parseInlineNumber('1234.5', 'money')).toEqual({ ok: true, value: 1234.5 });
    expect(parseInlineNumber('1\u00a0234,56', 'money')).toEqual({ ok: true, value: 1234.56 });
  });

  it('reads EMPTY as 0 — and 0 is a value that is saved', () => {
    expect(parseInlineNumber('', 'quantity')).toEqual({ ok: true, value: 0 });
    expect(parseInlineNumber('   ', 'money')).toEqual({ ok: true, value: 0 });
  });

  it('refuses letters, a minus and more decimals than the column holds', () => {
    expect(parseInlineNumber('abc', 'money')).toEqual({ ok: false });
    expect(parseInlineNumber('-5', 'quantity')).toEqual({ ok: false });
    expect(parseInlineNumber('1e3', 'quantity')).toEqual({ ok: false });
    expect(parseInlineNumber('12,345', 'money')).toEqual({ ok: false });
    expect(parseInlineNumber('12,3456', 'quantity')).toEqual({ ok: false });
  });

  it('keeps three decimals on a quantity and a percent', () => {
    expect(parseInlineNumber('17,125', 'quantity')).toEqual({ ok: true, value: 17.125 });
    expect(parseInlineNumber('12,5', 'percent')).toEqual({ ok: true, value: 12.5 });
  });
});

describe('formatting', () => {
  it('shows Ukrainian grouping and a comma; money always with kopecks', () => {
    expect(formatInlineNumber(11499.92, 'money')).toBe('11 499,92');
    expect(formatInlineNumber(850, 'money')).toBe('850,00');
    expect(formatInlineNumber(1234.5, 'quantity')).toBe('1 234,5');
  });

  it('starts editing from the bare number, no grouping, no trailing zeros', () => {
    expect(editableInlineNumber(1234.5, 'money')).toBe('1234,5');
    expect(editableInlineNumber(850, 'money')).toBe('850');
  });

  it('compares at the column scale', () => {
    expect(sameInlineNumber(1.0004, 1, 'quantity')).toBe(true);
    expect(sameInlineNumber(1.001, 1, 'quantity')).toBe(false);
  });
});

describe('normalizeInlineText', () => {
  it('trims, and an empty name means «keep the old one»', () => {
    expect(normalizeInlineText('  Стяжка  ')).toBe('Стяжка');
    expect(normalizeInlineText('   ')).toBeNull();
  });
});

describe('toastUndoable', () => {
  beforeEach(() => resetUndoToastForTests());

  it('replaces the previous undo toast, so only the LAST change is undoable', () => {
    const dismiss = vi.spyOn(toast, 'dismiss');
    const success = vi.spyOn(toast, 'success').mockReturnValueOnce(41).mockReturnValueOnce(42);
    toastUndoable('Збережено', vi.fn());
    toastUndoable('Збережено', vi.fn());
    expect(dismiss).toHaveBeenCalledWith(41);
    expect(success).toHaveBeenLastCalledWith('Збережено', expect.objectContaining({ ttlMs: 5000 }));
    success.mockRestore();
    dismiss.mockRestore();
  });
});
