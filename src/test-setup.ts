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
configure({ asyncUtilTimeout: 5_000 });
