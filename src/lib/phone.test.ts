import { describe, it, expect } from 'vitest';
import { isCallablePhone, normalizeUaPhone } from './phone.ts';

describe('normalizeUaPhone', () => {
  it('reads every usual spelling of a Ukrainian number', () => {
    expect(normalizeUaPhone('067 123 45 67')).toBe('+380671234567');
    expect(normalizeUaPhone('+380671234567')).toBe('+380671234567');
    expect(normalizeUaPhone('380-67-123-45-67')).toBe('+380671234567');
    expect(normalizeUaPhone('(067) 123-45-67')).toBe('+380671234567');
  });

  it('refuses a digit too few or too many', () => {
    expect(normalizeUaPhone('067 123 45 6')).toBeNull();
    expect(normalizeUaPhone('+3806712345678')).toBeNull();
    expect(normalizeUaPhone('12345')).toBeNull();
  });
});

describe('isCallablePhone', () => {
  it('takes a Ukrainian number, or a foreign one written with its «+»', () => {
    expect(isCallablePhone('0671234567')).toBe(true);
    expect(isCallablePhone('+48 512 345 678')).toBe(true);
    expect(isCallablePhone('512 345 678')).toBe(false);
    expect(isCallablePhone('+380')).toBe(false);
  });
});
