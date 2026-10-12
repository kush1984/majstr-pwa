/**
 * Keys an earlier build wrote to this device's `localStorage` and nothing reads any more.
 *
 * <p>The material calculator kept its answers here per estimate (`materials:<id>:params`, 1b189b6)
 * until they moved onto the server (V142). That build shipped, so the keys sit on phones that ran
 * it; harmless, but a privacy-minded storage sweep should not find an estimate's figures in a
 * browser that no longer needs them (review P-72).</p>
 */
const LEGACY = /^materials:[^:]+:params$/;

export function dropLegacyStorage(storage: Storage | undefined = globalThis.localStorage): void {
  try {
    if (!storage) return;
    const stale: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && LEGACY.test(key)) stale.push(key);
    }
    for (const key of stale) storage.removeItem(key);
  } catch {
    /* storage blocked (private mode, site data off) — nothing to clean */
  }
}
