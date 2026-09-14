import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  speechAvailability,
  speechRecognitionCtor,
  type SpeechAvailability,
  type SpeechRecognitionLike,
} from '@/lib/speech.ts';

/** Why the microphone stopped being on offer for the rest of this screen's life. */
export type SpeechBlock = 'denied' | 'service' | 'audio' | 'network';

/** Consecutive `no-speech` rounds before we stop re-arming — roughly a quarter-minute of nothing. */
const MAX_SILENT_RESTARTS = 3;
/** The backstop, for browsers that never send `no-speech`: this long with nothing recognised. */
const MAX_SILENT_MS = 60_000;

/**
 * One tap of the microphone = one listening session, appended to the field as he speaks.
 *
 * <p><b>`continuous` is never set true, on any platform.</b> On iOS it hangs the microphone — the
 * recogniser never ends and no result arrives. So the recogniser runs ONE utterance at a time and
 * this hook re-arms it from `onend`, which is what makes a session outlast the first pause (master
 * feedback 2026-09-04: «дуже скоро обривається конекшин коли надиктовуєш»).</p>
 *
 * <p><b>That re-arm is BOUNDED, and the bound is the point.</b> Restarting unconditionally is its
 * own runaway: silence re-arms into silence, the microphone stays hot, the screen stays awake, and
 * on some browsers every restart is another permission prompt. So a run of
 * {@link MAX_SILENT_RESTARTS} `no-speech` rounds — or {@link MAX_SILENT_MS} with nothing recognised
 * at all — stops it and raises `heardNothing`. That is a NUDGE, not a block: the button stays and
 * one tap re-arms it. Anything actually heard, interim included, resets both, so a master who is
 * mid-position is never cut off.</p>
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
  /**
   * The last run stopped because it heard nothing — a line to show, never a door that closes.
   *
   * <p>Deliberately NOT a {@link SpeechBlock}: those take the button off the screen for the rest of
   * this screen's life, and silence is the one «failure» that is usually just a master who has not
   * started talking yet.</p>
   */
  const [heardNothing, setHeardNothing] = useState(false);
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
  /** Consecutive `no-speech` rounds. Any recognised audio puts it back to zero. */
  const silentRestartsRef = useRef(0);
  /** When anything was last heard — the backstop's clock, reset by the same audio. */
  const lastHeardAtRef = useRef(0);
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

  /**
   * Stop re-arming — he is not talking, and asking again forever costs battery, a hot microphone
   * and (on some browsers) another permission prompt each round. Clearing the intent is what drops
   * `onend` into its «he tapped stop» branch instead of scheduling the next recogniser.
   */
  const giveUpOnSilence = useCallback(() => {
    wantListenRef.current = false;
    setHeardNothing(true);
  }, []);

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
    // A fresh tap, as opposed to the `onend` re-arm below — that one never lets the intent drop.
    // Clear the silence run and the hint the previous session may have left on screen.
    if (!wantListenRef.current) {
      silentRestartsRef.current = 0;
      lastHeardAtRef.current = Date.now();
      setHeardNothing(false);
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
      if (pending.trim() || finalText.trim()) {
        // He is talking, so the silence run is over. An INTERIM result counts: a long position can
        // take longer to say than the backstop allows, and the caps exist to catch a recogniser
        // restarting into nothing — never to cut off someone mid-sentence.
        silentRestartsRef.current = 0;
        lastHeardAtRef.current = Date.now();
      }
      if (finalText.trim()) onFinalRef.current(finalText.trim());
    };

    rec.onerror = (e) => {
      if (e.error === 'aborted') return; // he pressed stop
      if (e.error === 'no-speech') {
        // Silence is not a failure. A RUN of it is a runaway, because `onend` below re-arms
        // straight back into the same silence.
        silentRestartsRef.current += 1;
        if (silentRestartsRef.current >= MAX_SILENT_RESTARTS) giveUpOnSilence();
        return;
      }
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
      if (wantListenRef.current && Date.now() - lastHeardAtRef.current > MAX_SILENT_MS) {
        // Not every browser sends `no-speech`, so the counter alone can re-arm for as long as the
        // phone stays awake on a microphone that is simply not picking him up.
        giveUpOnSilence();
      }
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
  }, [giveUpOnSilence, lang, teardown]);

  return {
    /** Offer the button at all? */
    available: availability === 'ready' && blocked === null,
    availability,
    listening,
    /** What is being heard right now — shown beside the field, never written into it mid-word. */
    interim,
    blocked,
    /** The last session gave up on silence: show a nudge, keep the button — one tap re-arms it. */
    heardNothing,
    start,
    stop,
  };
}
