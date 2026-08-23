import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bodyScrollLocked, scrollRowIntoView } from './scrollRowIntoView.ts';

/**
 * The reason this helper exists at all: in Chrome on Windows with "Smooth Scrolling" off, a smooth
 * scroll does nothing whatsoever — no movement, no error, and `prefers-reduced-motion` reads false,
 * so there is no flag to branch on. These tests pin the fallback, because without it the
 * scroll-to-added-position feature is silently dead on that setup (and it was).
 */
describe('scrollRowIntoView', () => {
  let calls: (ScrollIntoViewOptions | boolean | undefined)[];
  let rect: { top: number; bottom: number };

  const row = () => ({
    scrollIntoView: (opts?: ScrollIntoViewOptions | boolean) => calls.push(opts),
    getBoundingClientRect: () => rect,
  }) as unknown as Element;

  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    rect = { top: 2000, bottom: 2060 };
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true, writable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.style.position = '';
  });

  it('falls back to an instant scroll when the smooth one moved nothing', () => {
    scrollRowIntoView(row());
    expect(calls).toEqual([{ behavior: 'smooth', block: 'center' }]);

    vi.runAllTimers();

    // Second call carries NO behavior — that is the instant form, the only one that works there.
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ block: 'center' });
  });

  it('leaves a working smooth scroll alone', () => {
    scrollRowIntoView(row());
    (window as unknown as { scrollY: number }).scrollY = 1700; // the animation is running

    vi.runAllTimers();

    expect(calls).toHaveLength(1);
  });

  it('does not re-scroll a row that is already fully visible', () => {
    rect = { top: 100, bottom: 166 };
    scrollRowIntoView(row());

    vi.runAllTimers();

    expect(calls).toHaveLength(1);
  });
});

describe('scrollRowIntoView inside a scrolling container', () => {
  /**
   * A list with its own `overflow-y` is what actually moves — and inside a modal it is the ONLY
   * thing that can, because the page is frozen. Asking the window whether anything moved would say
   * "no" every time and fire the instant fallback even while the animation was running fine.
   */
  const build = (opts: { rowTop: number; rowBottom: number; scrollTop: number }) => {
    const calls: (ScrollIntoViewOptions | boolean | undefined)[] = [];
    const box = {
      scrollTop: opts.scrollTop,
      scrollHeight: 900,
      clientHeight: 300,
      parentElement: null,
      getBoundingClientRect: () => ({ top: 100, bottom: 400 }),
    };
    const row = {
      parentElement: box,
      scrollIntoView: (o?: ScrollIntoViewOptions | boolean) => calls.push(o),
      getBoundingClientRect: () => ({ top: opts.rowTop, bottom: opts.rowBottom }),
    };
    return { row: row as unknown as Element, box, calls };
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window, 'getComputedStyle')
      .mockReturnValue({ overflowY: 'auto' } as unknown as CSSStyleDeclaration);
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('falls back instantly when the container did not move', () => {
    const { row, calls } = build({ rowTop: 700, rowBottom: 760, scrollTop: 0 });
    scrollRowIntoView(row);
    vi.runAllTimers();
    expect(calls).toEqual([{ behavior: 'smooth', block: 'center' }, { block: 'center' }]);
  });

  it('leaves the animation alone when the CONTAINER scrolled, not the window', () => {
    const { row, box, calls } = build({ rowTop: 700, rowBottom: 760, scrollTop: 0 });
    scrollRowIntoView(row);
    box.scrollTop = 240; // the container is animating; window.scrollY never budges
    vi.runAllTimers();
    expect(calls).toHaveLength(1);
  });

  it('measures visibility against the container, not the viewport', () => {
    // Well inside the window (0..800) but clipped by the container (100..400) — it must still scroll.
    const { row, calls } = build({ rowTop: 500, rowBottom: 560, scrollTop: 0 });
    scrollRowIntoView(row);
    vi.runAllTimers();
    expect(calls).toHaveLength(2);
  });
});

describe('bodyScrollLocked', () => {
  afterEach(() => { document.body.style.position = ''; });

  it('reports the frozen body a Modal leaves behind while it is open', () => {
    expect(bodyScrollLocked()).toBe(false);
    // Exactly what Modal sets for its iOS-safe scroll lock.
    document.body.style.position = 'fixed';
    expect(bodyScrollLocked()).toBe(true);
  });
});
