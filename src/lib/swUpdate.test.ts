import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isUpdateReady, markUpdateReady, applyUpdate, subscribeUpdate } from './swUpdate.ts';

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('swUpdate bridge', () => {
  it('notifies subscribers and applies the captured updater', () => {
    const listener = vi.fn();
    const apply = vi.fn();
    const unsubscribe = subscribeUpdate(listener);

    expect(isUpdateReady()).toBe(false);

    markUpdateReady(apply);
    expect(listener).toHaveBeenCalledOnce();
    expect(isUpdateReady()).toBe(true);

    applyUpdate();
    expect(apply).toHaveBeenCalledOnce();

    unsubscribe();
    markUpdateReady(apply);
    expect(listener).toHaveBeenCalledOnce(); // still once — unsubscribed
  });
});

/**
 * The banner above is only reachable if TWO things outside this module hold, and neither of them
 * is expressible in application code — which is exactly how they were both wrong for a year while
 * every test stayed green: `registerType: 'autoUpdate'` throws `onNeedRefresh` away, and a
 * `skipWaiting()` on install means no worker ever reaches the `waiting` state that fires it.
 *
 * So they are asserted against the source. Crude, and the only thing that can catch a silent
 * regression of a feature whose failure mode is "nothing ever appears".
 */
describe('service-worker update contract (makes the banner reachable)', () => {
  const sw = read('../sw.ts');
  const viteConfig = read('../../vite.config.ts');

  it("registers in 'prompt' mode, so onNeedRefresh is actually called", () => {
    expect(viteConfig).toContain("registerType: 'prompt'");
  });

  it('never calls skipWaiting on install — the new worker must WAIT to be noticed', () => {
    expect(sw).not.toMatch(/addEventListener\(\s*'install'/);
  });

  it('activates only when the master asks, via the SKIP_WAITING message', () => {
    expect(sw).toContain("'SKIP_WAITING'");
    expect(sw).toContain('self.skipWaiting()');
  });

  it('claims open clients on activate, or the reload after the tap never lands', () => {
    expect(sw).toContain('self.clients.claim()');
  });
});
