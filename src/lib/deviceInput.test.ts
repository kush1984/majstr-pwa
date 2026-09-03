import { describe, it, expect, afterEach, vi } from 'vitest';
import { hasOnScreenKeyboard } from './deviceInput.ts';

const original = window.matchMedia;

function stub(matches: boolean) {
  const spy = vi.fn(() => ({ matches }) as MediaQueryList);
  Object.defineProperty(window, 'matchMedia', { value: spy, configurable: true, writable: true });
  return spy;
}

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', { value: original, configurable: true, writable: true });
});

describe('hasOnScreenKeyboard', () => {
  it('asks whether the primary pointer is coarse — the phone/tablet the 🎤 keyboard lives on', () => {
    const spy = stub(true);
    expect(hasOnScreenKeyboard()).toBe(true);
    expect(spy).toHaveBeenCalledWith('(pointer: coarse)');
  });

  it('is false on a desktop, where the OS keyboard has no Ukrainian dictation to offer', () => {
    stub(false);
    expect(hasOnScreenKeyboard()).toBe(false);
  });

  it('falls back to false rather than offering what may not work', () => {
    Object.defineProperty(window, 'matchMedia', {
      value: undefined, configurable: true, writable: true });
    expect(hasOnScreenKeyboard()).toBe(false);
  });
});
