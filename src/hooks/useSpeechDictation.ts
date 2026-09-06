import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  speechAvailability,
  speechRecognitionCtor,
  type SpeechAvailability,
  type SpeechRecognitionLike,
} from '@/lib/speech.ts';

/** Why the microphone stopped being on offer for the rest of this screen's life. */
export type SpeechBlock = 'denied' | 'service' | 'audio' | 'network';

/**
 * One tap of the microphone = one spoken utterance, appended to the field.
 *
 * <p><b>`continuous` is never set true, on any platform.</b> On iOS it hangs the microphone — the
 * recogniser never ends and no result arrives — and the workaround everyone reaches for (restart it
 * from `onend`) is a permission-re-prompt loop on some browsers and a runaway on others. So the
 * recogniser runs a single utterance: he taps, speaks a position or three, it stops on its own at
 * the pause, and the text lands in the field. Tapping again appends the next one. That is
 * predictable, and the field stays typed-into the whole time.</p>
 *
 * <p><b>Every runtime failure degrades, never explodes.</b> A denied permission, an unreachable
 * speech service (`service-not-allowed` — the iOS symptom), no microphone, or no network takes the
 * button off the screen for this session and leaves the master with what already worked: the
 * keyboard's own microphone. `no-speech` and `aborted` are not failures — he said nothing, or he
 * pressed stop.</p>
 */
export function useSpeechDictation({
  lang = 'uk-UA',
  onFinal,
}: {
  lang?: string;
  onFinal: (text: string) => void;
}) {
  const availability: SpeechAvailability = useMemo(() => speechAvailability(), []);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [blocked, setBlocked] = useState<SpeechBlock | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  /**
   * True while the master WANTS to keep dictating. `stop()` clears it (his intent), and only then
   * does `onend` NOT re-arm the recogniser.
   *
   * <p>Master feedback 2026-09-04: «дуже скоро обривається конекшин коли надиктовуєш» — the Web
   * Speech API's `continuous: false` mode ends the recogniser at the first pause, which reads to
   * the master as the mic breaking mid-sentence. We keep `continuous: false` (iOS hangs otherwise)
   * and simulate a longer listen by re-starting on `onend` unless he tapped stop.</p>
   */
  const wantListenRef = useRef(false);
  // The callback changes on every render of the sheet; the recogniser is created once per start.
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const teardown = useCallback(() => {
    // Component unmounted or the recogniser is being reset: no more restarts.
    wantListenRef.current = false;
    const rec = recRef.current;
    recRef.current = null;
    if (!rec) return;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    try {
      rec.abort();
    } catch {
      // Already dead — nothing to abort, and a throw here must not reach the master.
    }
  }, []);

  useEffect(() => teardown, [teardown]);

  const stop = useCallback(() => {
    // Clear intent FIRST — `stop()` will call `onend` synchronously on some browsers, and the
    // auto-restart branch below reads this ref to decide whether to re-arm.
    wantListenRef.current = false;
    const rec = recRef.current;
    setListening(false);
    setInterim('');
    if (!rec) return;
    try {
      rec.stop(); // stop(), not abort(): a final result already in flight is still his words
    } catch {
      teardown();
    }
  }, [teardown]);

  const start = useCallback(() => {
    if (recRef.current) return;
    const Ctor = speechRecognitionCtor();
    if (!Ctor) {
      setBlocked('service');
      return;
    }
    wantListenRef.current = true;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = false; // see the doc comment — never true
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      let finalText = '';
      let pending = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i];
        const text = r[0]?.transcript ?? '';
        if (r.isFinal) finalText += text;
        else pending += text;
      }
      setInterim(pending);
      if (finalText.trim()) onFinalRef.current(finalText.trim());
    };

    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      // A real error (denied / no device / offline / service refused) ends the session — clear
      // intent so onend does NOT try to re-arm into a broken state, and the button vanishes.
      wantListenRef.current = false;
      setBlocked(
        e.error === 'not-allowed'
          ? 'denied'
          : e.error === 'audio-capture'
            ? 'audio'
            : e.error === 'network'
              ? 'network'
              : 'service',
      );
    };

    rec.onend = () => {
      recRef.current = null;
      setInterim('');
      // Re-arm on the next tick if the master still wants to be heard. `continuous: false` is a
      // must (iOS hangs otherwise), but the master reads a mid-sentence auto-stop as the mic
      // breaking; a small delay lets a pending final result settle and dodges the tight-loop that
      // some browsers reject as abuse.
      if (wantListenRef.current) {
        window.setTimeout(() => {
          if (wantListenRef.current) start();
        }, 200);
      } else {
        setListening(false);
      }
    };

    recRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      // Some browsers throw if start() races a previous session's teardown.
      teardown();
      setListening(false);
      setBlocked('service');
    }
  }, [lang, teardown]);

  return {
    /** Offer the button at all? */
    available: availability === 'ready' && blocked === null,
    availability,
    listening,
    /** What is being heard right now — shown beside the field, never written into it mid-word. */
    interim,
    blocked,
    start,
    stop,
  };
}
