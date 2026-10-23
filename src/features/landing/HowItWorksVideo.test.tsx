import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/lib/i18n.ts';
import { LandingPage } from './LandingPage.tsx';

/**
 * The «Як це працює» loop. jsdom has neither IntersectionObserver nor matchMedia, so both are
 * stubbed here: the observer records its instances and the test decides what is on screen, and
 * matchMedia answers for a chosen viewport width and motion preference.
 */
class FakeObserver {
  static all: FakeObserver[] = [];
  readonly targets: Element[] = [];
  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit = {},
  ) {
    FakeObserver.all.push(this);
  }
  observe(target: Element) {
    this.targets.push(target);
  }
  unobserve() {}
  disconnect() {
    this.targets.length = 0;
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  fire(isIntersecting: boolean) {
    const entries = this.targets.map((target) => ({ target, isIntersecting }) as IntersectionObserverEntry);
    if (entries.length > 0) this.callback(entries, this as unknown as IntersectionObserver);
  }
}

/** Every observer at once: the frame scrolled near AND onto the screen, or off it again. */
function scroll(onScreen: boolean) {
  act(() => {
    for (const o of [...FakeObserver.all]) o.fire(onScreen);
  });
}

function viewport(width: number, reducedMotion = false) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches:
      query === '(max-width: 767px)'
        ? width <= 767
        : query === '(prefers-reduced-motion: reduce)'
          ? reducedMotion
          : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function renderVideo(): HTMLVideoElement {
  render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
  const video = document.querySelector('video');
  if (!video) throw new Error('no video on the landing');
  return video;
}

let play: ReturnType<typeof vi.spyOn>;
let pause: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  FakeObserver.all = [];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  viewport(1280);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('HowItWorks video', () => {
  it('is a silent, controlless loop that fetches nothing before the visitor scrolls', () => {
    const video = renderVideo();

    expect(video.getAttribute('preload')).toBe('none');
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.hasAttribute('controls')).toBe(false);
    expect(video.getAttribute('aria-label')).toBe(
      'Як працює Majstr: заміри, кошторис, підпис клієнта, матеріали, гроші',
    );
    expect(video.getAttribute('src')).toBeNull();
    expect(video.getAttribute('poster')).toBeNull();
  });

  it('takes the poster and plays once it is on screen', () => {
    const video = renderVideo();
    scroll(true);

    expect(video.getAttribute('poster')).toBe('/video/majstr-landing-poster.jpg');
    expect(play).toHaveBeenCalled();
  });

  it('chooses the 4:5 phone cut at 375 px', () => {
    viewport(375);
    const video = renderVideo();
    scroll(true);

    expect(video.getAttribute('src')).toBe('/video/majstr-landing-loop-mobile.mp4');
    expect(video.getAttribute('poster')).toBe('/video/majstr-landing-poster-mobile.jpg');
  });

  it('chooses the 16:9 cut at 1280 px', () => {
    viewport(1280);
    const video = renderVideo();
    scroll(true);

    expect(video.getAttribute('src')).toBe('/video/majstr-landing-loop.mp4');
    expect(video.getAttribute('poster')).toBe('/video/majstr-landing-poster.jpg');
  });

  it('does not play, or even fetch, while off screen — and pauses when scrolled away', () => {
    const video = renderVideo();
    scroll(false);

    expect(play).not.toHaveBeenCalled();
    expect(video.getAttribute('src')).toBeNull();

    scroll(true);
    Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
    scroll(false);
    expect(pause).toHaveBeenCalled();
  });

  it('keeps the poster and never plays under reduced motion', () => {
    viewport(375, true);
    const video = renderVideo();
    scroll(true);

    expect(play).not.toHaveBeenCalled();
    expect(video.getAttribute('poster')).toBe('/video/majstr-landing-poster-mobile.jpg');
    expect(video.getAttribute('src')).toBeNull();
  });

  it('keeps the poster and never plays when the phone asks to save data', () => {
    vi.stubGlobal('navigator', { ...navigator, connection: { saveData: true } });
    const video = renderVideo();
    scroll(true);

    expect(play).not.toHaveBeenCalled();
    expect(video.getAttribute('src')).toBeNull();
  });

  it('asks the near-observer a screen early, and plays only once a quarter of it is visible', () => {
    renderVideo();
    const options = FakeObserver.all.map((o) => o.options);

    expect(options).toContainEqual({ rootMargin: '300px 0px' });
    expect(options).toContainEqual({ threshold: 0.25 });
  });
});
