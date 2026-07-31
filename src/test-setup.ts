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
 * Honest status: still open, still ~1 run in 3, and both times it reappeared the error text was
 * lost by re-running before capturing it. NEXT TIME: capture the reporter output FIRST
 * (`npx vitest run 2>&1 | tee flake.log`), because "it passed on retry" has now cost three
 * diagnosis attempts and produced one wrong conclusion.
 *
 * This setting stays regardless: it is right for the general case and costs nothing on a passing
 * run, since `waitFor` polls and returns the moment the condition holds.
 */
