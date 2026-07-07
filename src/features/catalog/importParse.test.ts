import { describe, it, expect } from 'vitest';
import { guessUnit, parsePrice, guessType } from './importParse.ts';

describe('importParse (client mirror for column remap)', () => {
  it('guessUnit recognizes common synonyms', () => {
    expect(guessUnit('кв.м')).toBe('M2');
    expect(guessUnit('м²')).toBe('M2');
    expect(guessUnit('пог.м')).toBe('LINEAR_METER');
    expect(guessUnit('м.п.')).toBe('LINEAR_METER');
    expect(guessUnit('шт.')).toBe('PIECE');
    expect(guessUnit('м')).toBe('M');
    expect(guessUnit('невідомо')).toBeNull();
    expect(guessUnit('')).toBeNull();
  });

  it('parsePrice handles messy formats and rejects text', () => {
    expect(parsePrice('1 200,50 грн')).toBe(1200.5);
    expect(parsePrice('1200.50')).toBe(1200.5);
    expect(parsePrice('₴900')).toBe(900);
    expect(parsePrice('1.200,50')).toBe(1200.5);
    expect(parsePrice('Позиція 1')).toBeNull(); // a name, not a price
    expect(parsePrice('-5')).toBeNull();
    expect(parsePrice('')).toBeNull();
  });

  it('guessType flags materials by name marker', () => {
    expect(guessType('Грунтовка глибокого проникнення')).toBe('MATERIAL');
    expect(guessType('Демонтаж перегородок')).toBe('WORK');
  });
});
