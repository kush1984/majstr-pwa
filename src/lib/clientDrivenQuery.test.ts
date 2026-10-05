import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { CLIENT_DRIVEN_QUERY } from './clientDrivenQuery.ts';
import { clearOutbox, enqueue, getSyncStatus } from './outbox/outbox.ts';
import { tokens } from './tokens.ts';

/**
 * The focus refetch, and the one state it must not fire in (review P-42).
 *
 * <p>Four things change behind the master's back — a client signs, pays or asks a question — so
 * estimate, project-estimates, economy and acts refetch when he looks at the screen again. The
 * outbox flushes on the same `visibilitychange`, and the GET usually wins: it comes back with
 * server state that does not yet contain the queued ops, straight over the optimistic cache. The
 * master walked back into the kitchen and his three lines were gone — for 15 s on a good link, two
 * minutes on a failing op — so he typed them again, and the replay then landed the originals too.</p>
 */
const token = (sub: string) =>
  `h.${btoa(JSON.stringify({ sub })).replace(/=/g, '')}.s`;

beforeEach(async () => {
  await clearOutbox();
  tokens.set(token('master-a'), 'r');
});

const shouldRefetch = () => CLIENT_DRIVEN_QUERY.refetchOnWindowFocus();

describe('CLIENT_DRIVEN_QUERY', () => {
  it('refetches on focus while nothing is queued', () => {
    expect(getSyncStatus().pending).toBe(0);
    expect(shouldRefetch()).toBe(true);
  });

  it('does NOT refetch while the outbox still holds work', async () => {
    await enqueue({
      entityId: 'i1', entity: 'estimateItem', type: 'create', payload: {}, deps: [],
    });

    await vi.waitFor(() => expect(getSyncStatus().pending).toBe(1));
    expect(shouldRefetch()).toBe(false);
  });

  it('refetches again once the queue has drained', async () => {
    await enqueue({
      entityId: 'i1', entity: 'estimateItem', type: 'create', payload: {}, deps: [],
    });
    await vi.waitFor(() => expect(getSyncStatus().pending).toBe(1));

    await clearOutbox();

    await vi.waitFor(() => expect(getSyncStatus().pending).toBe(0));
    expect(shouldRefetch()).toBe(true);
  });
});
