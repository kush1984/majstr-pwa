/**
 * The in-app microphone — the Web Speech API, wrapped in the one thing it actually needs: an honest
 * answer to «can this device do it at all».
 *
 * <p><b>The iOS fact this file exists for.</b> It is widely repeated (and this project's own docs
 * repeated it until 2026-09-04) that iOS Safari has no `SpeechRecognition`. That is wrong —
 * `webkitSpeechRecognition` has shipped since Safari 14.5 (2021). The real limitation is narrower
 * and worse for us: <b>it does not work inside a PWA installed to the home screen.</b> An installed
 * PWA runs in a WKWebView-based container where Apple has not enabled the speech service, and the
 * failure is silent — the constructor is there, feature detection SUCCEEDS, `start()` throws
 * nothing, no microphone permission is ever requested, and no result ever arrives (sometimes an
 * `service-not-allowed` error, often nothing at all). Our manifest is `display: 'standalone'`, so
 * that is exactly the case most of our masters are in.</p>
 *
 * <p>Hence: detection alone is not enough, and {@link speechAvailability} refuses an installed iOS
 * PWA <em>before</em> looking for the constructor. What it degrades to is what already ships — the
 * plain text field plus the OS keyboard's own microphone, which works perfectly on iOS. Same rule
 * as `hasOnScreenKeyboard`: rather not offer it than offer it where it cannot work.</p>
 */

export interface SpeechAlternativeLike {
  readonly transcript: string;
}

export interface SpeechResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechAlternativeLike;
}

export interface SpeechResultListLike {
  readonly length: number;
  readonly [index: number]: SpeechResultLike;
}

export interface SpeechResultEventLike {
  readonly resultIndex: number;
  readonly results: SpeechResultListLike;
}

export interface SpeechErrorEventLike {
  readonly error: string;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechResultEventLike) => void) | null;
  onerror: ((e: SpeechErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechWindow {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
}

interface IosNavigator {
  standalone?: boolean;
}

/**
 * `ready` — try it. `installedIos` — the constructor may well be there and lying (see the file
 * comment). `unsupported` — no constructor at all (Firefox, older WebViews).
 */
export type SpeechAvailability = 'ready' | 'installedIos' | 'unsupported';

/** iPadOS 13+ reports itself as a Mac, so the touch-point count is the only tell left. */
function isApplePhoneOrTablet(): boolean {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return ua.includes('Macintosh') && navigator.maxTouchPoints > 1;
}

/** Installed to the home screen: Apple's own legacy flag, plus the standard display-mode query. */
function isInstalled(): boolean {
  if ((navigator as Navigator & IosNavigator).standalone === true) return true;
  return window.matchMedia?.('(display-mode: standalone)').matches ?? false;
}

export function speechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as SpeechWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechAvailability(): SpeechAvailability {
  // Deliberately BEFORE the feature check: on an installed iOS PWA the feature check passes and the
  // microphone still never opens, which is the worst of the three answers to give a master.
  if (isApplePhoneOrTablet() && isInstalled()) return 'installedIos';
  return speechRecognitionCtor() ? 'ready' : 'unsupported';
}
