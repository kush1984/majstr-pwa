import { describe, it, expect } from 'vitest';
import { editableReceiptLabel, isServerReceiptName } from './receiptName.ts';

describe('the server\'s «Чек №N»', () => {
  it('is recognised only in its exact shape', () => {
    expect(isServerReceiptName('Чек №1')).toBe(true);
    expect(isServerReceiptName('Чек №12')).toBe(true);
    expect(isServerReceiptName('Чек №1 Кабель')).toBe(false);
    expect(isServerReceiptName('Будмаркет')).toBe(false);
    expect(isServerReceiptName(null)).toBe(false);
  });

  // Typing into a field holding «Чек №1» appended: «Чек №1Кабель, підрозетники».
  it('starts the field empty, so typing replaces it', () => {
    expect(editableReceiptLabel('Чек №3')).toBe('');
    expect(editableReceiptLabel('Будмаркет — кабель')).toBe('Будмаркет — кабель');
  });
});
