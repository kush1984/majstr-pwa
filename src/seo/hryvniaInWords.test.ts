import { describe, it, expect } from 'vitest';
import { hryvniaInWords } from './hryvniaInWords.ts';

// The backend's HryvniaInWordsTest, case for case — the act PDF and the sample page must spell alike.
const words = (amount: string) => hryvniaInWords(Math.round(Number(amount) * 100));

describe('hryvniaInWords', () => {
  it('declines hryvnia and picks the feminine numeral', () => {
    expect(words('0.00')).toBe('Нуль гривень 00 копійок');
    expect(words('1.00')).toBe('Одна гривня 00 копійок');
    expect(words('2.00')).toBe('Дві гривні 00 копійок');
    expect(words('5.00')).toBe("П'ять гривень 00 копійок");
    expect(words('11.00')).toBe('Одинадцять гривень 00 копійок');
    expect(words('14.00')).toBe('Чотирнадцять гривень 00 копійок');
    expect(words('21.00')).toBe('Двадцять одна гривня 00 копійок');
    expect(words('100.00')).toBe('Сто гривень 00 копійок');
    expect(words('101.00')).toBe('Сто одна гривня 00 копійок');
  });

  it('spells thousands (feminine) and millions (masculine)', () => {
    expect(words('1000.00')).toBe('Одна тисяча гривень 00 копійок');
    expect(words('2000.00')).toBe('Дві тисячі гривень 00 копійок');
    expect(words('5000.00')).toBe("П'ять тисяч гривень 00 копійок");
    expect(words('1000000.00')).toBe('Один мільйон гривень 00 копійок');
  });

  it('keeps kopecks as digits with their own declension', () => {
    expect(words('0.50')).toBe('Нуль гривень 50 копійок');
    expect(words('1.01')).toBe('Одна гривня 01 копійка');
    expect(words('12.50')).toBe('Дванадцять гривень 50 копійок');
  });

  it('reads real act totals', () => {
    expect(words('1500.05')).toBe("Одна тисяча п'ятсот гривень 05 копійок");
    expect(words('62300.00')).toBe('Шістдесят дві тисячі триста гривень 00 копійок');
  });
});
