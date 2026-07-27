import { beforeEach, describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  persistQueryClientRestore,
  persistQueryClientSave,
} from '@tanstack/react-query-persist-client';
import { del } from 'idb-keyval';
import { offlinePersister, shouldDehydrateQuery } from './offlinePersist.ts';

/**
 * End-to-end check of the offline read cache: what one session writes to IndexedDB, the NEXT
 * session (a cold app start, e.g. a PWA relaunched in a basement) must get back.
 *
 * This is the mechanism behind "online everything is there, offline the catalog and templates are
 * empty" — the lists ARE fetched while online, so if the round trip works they have to survive.
 * Mirrors main.tsx exactly: same persister, same dehydrate predicate, same maxAge and buster.
 */
const WEEK_MS = 1000 * 60 * 60 * 24 * 7;
const CACHE_SCHEMA = 'v1';

const CATALOG = ['catalog', 'list', 'all'] as const;
const TEMPLATES = ['estimate-templates'] as const;
const PROJECTS = ['projects', 'list', 'all'] as const;

function client() {
  // gcTime must outlive the snapshot or restored queries are collected before they are read.
  return new QueryClient({ defaultOptions: { queries: { gcTime: WEEK_MS } } });
}

async function save(qc: QueryClient) {
  await persistQueryClientSave({
    queryClient: qc,
    persister: offlinePersister,
    buster: CACHE_SCHEMA,
    dehydrateOptions: { shouldDehydrateQuery },
  });
}

async function restoreInto(qc: QueryClient) {
  await persistQueryClientRestore({
    queryClient: qc,
    persister: offlinePersister,
    maxAge: WEEK_MS,
    buster: CACHE_SCHEMA,
  });
}

describe('offline cache round trip', () => {
  beforeEach(async () => {
    await del('majstr-query-cache').catch(() => undefined);
  });

  it('gives the catalog and the templates back to a cold app start', async () => {
    const online = client();
    online.setQueryData(CATALOG, [{ id: 'c1', name: 'Штукатурка' }]);
    online.setQueryData(TEMPLATES, [{ id: 't1', name: 'Ванна під ключ' }]);
    online.setQueryData(PROJECTS, [{ id: 'p1', name: 'Об’єкт' }]);
    await save(online);

    const coldStart = client();
    await restoreInto(coldStart);

    expect(coldStart.getQueryData(CATALOG)).toEqual([{ id: 'c1', name: 'Штукатурка' }]);
    expect(coldStart.getQueryData(TEMPLATES)).toEqual([{ id: 't1', name: 'Ванна під ключ' }]);
    expect(coldStart.getQueryData(PROJECTS)).toEqual([{ id: 'p1', name: 'Об’єкт' }]);
  });

  it('keeps a list whose refetch failed offline (the self-erasing-cache regression)', async () => {
    const session = client();
    await session.fetchQuery({ queryKey: CATALOG, queryFn: () => Promise.resolve([{ id: 'c1' }]) });
    // Now the master walks into a basement and opens the add-item sheet: the query refires and
    // fails, leaving an error ON TOP of the data.
    await session
      .fetchQuery({
        queryKey: CATALOG,
        queryFn: () => Promise.reject(new Error('Network Error')),
        retry: false,
      })
      .catch(() => undefined);
    expect(session.getQueryState(CATALOG)?.status).toBe('error');
    await save(session);

    const coldStart = client();
    await restoreInto(coldStart);

    // Before the fix the default predicate dropped this query and the catalog was gone for good.
    expect(coldStart.getQueryData(CATALOG)).toEqual([{ id: 'c1' }]);
  });

  it('drops everything when the cache schema is bumped', async () => {
    const online = client();
    online.setQueryData(CATALOG, [{ id: 'c1' }]);
    await save(online);

    const coldStart = client();
    await persistQueryClientRestore({
      queryClient: coldStart,
      persister: offlinePersister,
      maxAge: WEEK_MS,
      buster: 'v2', // an incompatible DTO change
    });

    expect(coldStart.getQueryData(CATALOG)).toBeUndefined();
  });

  it('drops everything older than maxAge', async () => {
    const online = client();
    online.setQueryData(CATALOG, [{ id: 'c1' }]);
    await save(online);

    const coldStart = client();
    await persistQueryClientRestore({
      queryClient: coldStart,
      persister: offlinePersister,
      maxAge: -1, // pretend the snapshot is ancient
      buster: CACHE_SCHEMA,
    });

    expect(coldStart.getQueryData(CATALOG)).toBeUndefined();
  });
});
