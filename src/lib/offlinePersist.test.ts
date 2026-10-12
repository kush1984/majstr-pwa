import { describe, expect, it } from 'vitest';
import {
  QueryClient,
  defaultShouldDehydrateQuery,
  dehydrate,
  hydrate,
} from '@tanstack/react-query';
import { markRestoredStale, shouldDehydrateQuery } from './offlinePersist.ts';

/**
 * Guards the offline read cache against the bug that made it erase itself.
 *
 * With `networkMode: 'offlineFirst'` a screen opened with no signal still fires its request; the
 * request fails and the query ends up in `error` WITH its data intact. React Query's default
 * dehydrate predicate keeps only `status === 'success'`, so that query — data and all — was
 * dropped from the next IndexedDB snapshot. Every offline session therefore ate part of the
 * cache: the master read an estimate in a basement, and the catalog and templates were gone by
 * the next launch.
 */
describe('shouldDehydrateQuery', () => {
  /** A query fetched successfully once, then failed on a refetch — the everyday offline case. */
  async function queryWithDataButFailedRefetch() {
    const qc = new QueryClient();
    await qc.fetchQuery({ queryKey: ['catalog'], queryFn: () => Promise.resolve(['item']) });
    await qc
      .fetchQuery({
        queryKey: ['catalog'],
        queryFn: () => Promise.reject(new Error('Network Error')),
        retry: false,
      })
      .catch(() => undefined);
    return qc;
  }

  it('keeps a query whose refetch failed offline but still holds data', async () => {
    const qc = await queryWithDataButFailedRefetch();
    const query = qc.getQueryCache().find({ queryKey: ['catalog'] })!;

    // Precondition: this is the state the bug hinged on — an error sitting on top of real data.
    expect(query.state.data).toEqual(['item']);
    expect(query.state.status).toBe('error');

    // The default predicate is what silently deleted it.
    expect(defaultShouldDehydrateQuery(query)).toBe(false);
    expect(shouldDehydrateQuery(query)).toBe(true);

    const snapshot = dehydrate(qc, { shouldDehydrateQuery });
    expect(snapshot.queries.map((q) => q.queryKey)).toContainEqual(['catalog']);
  });

  it('still drops a query that never produced any data', async () => {
    const qc = new QueryClient();
    await qc
      .fetchQuery({
        queryKey: ['templates'],
        queryFn: () => Promise.reject(new Error('Network Error')),
        retry: false,
      })
      .catch(() => undefined);
    const query = qc.getQueryCache().find({ queryKey: ['templates'] })!;

    expect(query.state.data).toBeUndefined();
    expect(shouldDehydrateQuery(query)).toBe(false);

    const snapshot = dehydrate(qc, { shouldDehydrateQuery });
    expect(snapshot.queries).toHaveLength(0); // nothing useful to persist
  });

  it('keeps a plain successful query', async () => {
    const qc = new QueryClient();
    await qc.fetchQuery({ queryKey: ['clients'], queryFn: () => Promise.resolve([]) });
    const query = qc.getQueryCache().find({ queryKey: ['clients'] })!;

    expect(shouldDehydrateQuery(query)).toBe(true);
  });
});

/**
 * A snapshot restored seconds after it was written still reads as fresh, and the write that came
 * after it is not in it — `journey.spec` caught «Обʼєкти» showing an empty list for an object the
 * server had, for as long as the screen stayed open.
 */
describe('markRestoredStale', () => {
  it('makes a restored query stale even when its snapshot is younger than staleTime', async () => {
    const before = new QueryClient();
    await before.fetchQuery({ queryKey: ['projects', 'list', 'all'], queryFn: () => Promise.resolve([]) });
    const snapshot = dehydrate(before);

    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
    hydrate(qc, snapshot);
    const query = qc.getQueryCache().find({ queryKey: ['projects', 'list', 'all'] })!;
    expect(query.isStaleByTime(30_000)).toBe(false); // the trap: fresh by the clock

    await markRestoredStale(qc);

    expect(query.state.isInvalidated).toBe(true);
    expect(query.state.data).toEqual([]); // the data stays on screen until the answer arrives
  });

  it('fetches nothing by itself', async () => {
    const qc = new QueryClient();
    let calls = 0;
    await qc.fetchQuery({ queryKey: ['catalog'], queryFn: () => { calls += 1; return Promise.resolve(['x']); } });

    await markRestoredStale(qc);

    expect(calls).toBe(1);
  });
});
