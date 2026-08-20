// Global vitest setup. jsdom has no IndexedDB, but the offline outbox (Dexie) and the persisted
// query cache (idb-keyval) use it — so provide a fake implementation for every test. Individual
// outbox tests still clear the queue in their own beforeEach.
import 'fake-indexeddb/auto';
import { configure } from '@testing-library/react';

/**
 * Testing Library's `waitFor`/`findBy*` default is **1 second**, which is not a statement about
 * correctness — it is a bet on how fast the machine is. Several suites here do real work inside
 * that window (pdfjs parsing a fixture, a tree rendering under a QueryClient), so on a loaded
 * machine an assertion times out while the code is perfectly fine.
 *
 * That produced the worst kind of failure: a full run going red roughly one time in three, always
 * in a measurably SLOWER run, never reproducibly — the clean runs here take ~38 s, the two that
 * failed took 105 s and 47 s. One such test was already tracked down and patched with explicit
 * per-call timeouts; raising the default kills the whole class instead of waiting for each one to
 * be found by a random red CI, which is what erodes trust in the gate.
 *
 * This does NOT slow passing tests down — `waitFor` polls and returns the moment the condition
 * holds. The timeout only bounds the FAILING case, so the extra seconds are spent only when
 * something is genuinely broken.
 */
configure({ asyncUtilTimeout: 10_000 });

/*
 * 10s, not 5s: at 5s it still failed on a run that took 100s wall-clock while passing on every
 * ~38s run. Four failures observed, all on slow runs, none reproducible on demand — which is why
 * the number is set from the evidence rather than from a diagnosis.
 *
 * IDENTIFIED, NOT FIXED (2026-07-31). The name this note was waiting for is
 * `ProjectImportSheet > AUTO-parses the useful sheets …, commits the package`, and it is NOT a
 * `waitFor` timing out — that test parses real PDFs through pdfjs and carries its own PER-TEST
 * budget, which no global `asyncUtilTimeout` can extend. That budget was raised 20 s → 60 s, the
 * suite went green, **and the same test failed again on the very next full run anyway.**
 *
 * So the "CPU contention" reading is probably wrong too: 385 ms in isolation against a >60 s
 * budget is a 150× spread, which no loaded machine explains. Something about running this file
 * CONCURRENTLY with the other 72 is the actual variable — leaked global state, a shared fake-IDB,
 * an ordering assumption — and that has not been found yet.
 *
 * SOLVED 2026-07-31, and the answer was in none of the three theories that preceded it. Kept in
 * full because the WAY it was found is the reusable part: three diagnoses were wrong while the
 * error text kept being thrown away by re-running, and the fix arrived within minutes of finally
 * capturing it.
 *
 * The cause: `pdfPageTexts` can HANG — pdfjs does not promise to reject on a file it cannot parse,
 * and the import awaited it unbounded, so the sheet never left its first screen. Bounded now in
 * `lib/projectDocs.ts`, proven by dropping that bound below the test's own wait and watching three
 * consecutive full runs go green. It was a product bug too: a master with a corrupt PDF got an
 * import sheet frozen on «Обрати файли», no error, no way forward.
 *
 * The evidence that cracked it — note that NONE of it is about time:
 *
 *     AssertionError: expected "spy" to be called 2 times, but got 0 times
 *
 * and the rendered DOM shows the sheet still on its FIRST step — the «Обрати файли» screen. So
 * `onPick` never reached `setStep`/`setDocs` at all: `projectImportApi.parse` was never called,
 * which is why no per-test budget could ever have fixed it.
 *
 * That left two candidates inside `onPick` — an await that never settles, or its
 * `catch { toast.error(); return; }` firing — and the DOM looks identical either way. What
 * separated them was a one-line experiment rather than more reading: drop the new bound on
 * `pdfPageTexts` BELOW the test's own wait and re-run. If the await was hanging, the guard would
 * fire, the flow would recover, and the suite would go green. It did, three runs out of three.
 *
 * (Watch out for the false detector that nearly derailed this: grepping the run for the timeout's
 * message finds nothing, because `pdfRows` catches and discards it. Absence there proves nothing.)
 *
 * This setting stays regardless: it is right for the general case and costs nothing on a passing
 * run, since `waitFor` polls and returns the moment the condition holds.
 */

/**
 * jsdom and Node's built-in `fetch` disagree about `AbortSignal`, and a **data router** navigation
 * is what walks into it: react-router's `createClientSideRequest` does `new Request(path, {signal})`
 * with a signal from `new AbortController()` — jsdom's controller — while `Request` comes from
 * Node's undici, which brand-checks it against its OWN class and throws
 * `RequestInit: Expected signal ("AbortSignal {}") to be an instance of AbortSignal`.
 * The rejection is unhandled, the navigation never resolves, and the test dies on its timeout with
 * no hint that routing was the culprit (two `ActEditorPage` leave-guard tests, 2026-08-20).
 *
 * There is no "just use the native controller" fix available here: in this environment
 * `globalThis.AbortSignal` is already native, but `globalThis.AbortController` is jsdom's and Node
 * exposes no other way to build a controller. So the incompatible `signal` is dropped instead —
 * nothing under test aborts a request, and the app itself never passes a signal to `fetch`.
 *
 * Only patched when the mismatch is real (it reproduces on Node 24, not on CI's Node 22), so on a
 * matching runtime the global `Request` stays untouched.
 */
const BaseRequest = globalThis.Request;
const signalIsAccepted = (() => {
  try {
    new BaseRequest('http://localhost/probe', { signal: new AbortController().signal });
    return true;
  } catch {
    return false;
  }
})();
if (!signalIsAccepted) {
  globalThis.Request = class extends BaseRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      const { signal: _signal, ...rest } = init ?? {};
      super(input, rest);
    }
  };
}
