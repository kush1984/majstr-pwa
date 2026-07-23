// Global vitest setup. jsdom has no IndexedDB, but the offline outbox (Dexie) and the persisted
// query cache (idb-keyval) use it — so provide a fake implementation for every test. Individual
// outbox tests still clear the queue in their own beforeEach.
import 'fake-indexeddb/auto';
