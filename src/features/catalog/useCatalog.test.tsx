import 'fake-indexeddb/auto';
import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import {
  CATALOG_KEY,
  useCreateCatalogItem,
  useDeleteCatalogItem,
  useUpdateCatalogItem,
} from './useCatalog.ts';
import { clearOutbox, listOutbox } from '@/lib/outbox/outbox.ts';
import type { CatalogItemResponse } from '@/api/types.ts';

// Drive the OFFLINE branch: writes go optimistic + into the outbox (online would call the real API).
beforeEach(async () => { await clearOutbox(); onlineManager.setOnline(false); });
afterEach(() => onlineManager.setOnline(true));

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

const allKey = [...CATALOG_KEY, 'list', 'all'];
const worksKey = [...CATALOG_KEY, 'list', 'WORK'];

function item(over: Partial<CatalogItemResponse> = {}): CatalogItemResponse {
  return {
    id: 'k1', name: 'Штукатурка', category: 'Стіни', trade: 'BUILDER',
    customTradeId: null, customTradeName: null,
    type: 'WORK', unit: 'M2', defaultPrice: 250, sortOrder: 0, createdAt: '2026-01-01', ...over,
  };
}

describe('useCatalog — offline authoring (queued)', () => {
  it('create: inserts into the matching lists only and queues a create carrying the UUID', async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData<CatalogItemResponse[]>(allKey, []);
    qc.setQueryData<CatalogItemResponse[]>(worksKey, []);
    qc.setQueryData<CatalogItemResponse[]>([...CATALOG_KEY, 'list', 'MATERIAL'], []);
    const { result } = renderHook(() => useCreateCatalogItem(), { wrapper });

    let created: CatalogItemResponse | undefined;
    await act(async () => {
      created = await result.current.mutateAsync({
        name: 'Ґрунтовка', type: 'WORK', unit: 'M2', defaultPrice: 40,
      });
    });

    expect(created?.id).toBeTruthy();
    expect(qc.getQueryData<CatalogItemResponse[]>(allKey)).toHaveLength(1);
    expect(qc.getQueryData<CatalogItemResponse[]>(worksKey)).toHaveLength(1);
    // A WORK must not appear in the MATERIAL-filtered list.
    expect(qc.getQueryData<CatalogItemResponse[]>([...CATALOG_KEY, 'list', 'MATERIAL'])).toHaveLength(0);

    const ops = await listOutbox();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ entityId: created!.id, entity: 'catalogItem', type: 'create' });
  });

  it('update: repricing patches every cached list and queues an update op', async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData<CatalogItemResponse[]>(allKey, [item()]);
    qc.setQueryData<CatalogItemResponse[]>(worksKey, [item()]);
    const { result } = renderHook(() => useUpdateCatalogItem(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: 'k1',
        req: { name: 'Штукатурка', type: 'WORK', unit: 'M2', defaultPrice: 300 },
      });
    });

    expect(qc.getQueryData<CatalogItemResponse[]>(allKey)?.[0].defaultPrice).toBe(300);
    expect(qc.getQueryData<CatalogItemResponse[]>(worksKey)?.[0].defaultPrice).toBe(300);
    const ops = await listOutbox();
    expect(ops[0]).toMatchObject({ entityId: 'k1', entity: 'catalogItem', type: 'update' });
  });

  it('delete: drops it from the cache and queues a delete op', async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData<CatalogItemResponse[]>(allKey, [item(), item({ id: 'k2', name: 'Шпаклівка' })]);
    const { result } = renderHook(() => useDeleteCatalogItem(), { wrapper });

    await act(async () => { await result.current.mutateAsync('k1'); });

    expect(qc.getQueryData<CatalogItemResponse[]>(allKey)?.map((i) => i.id)).toEqual(['k2']);
    const ops = await listOutbox();
    expect(ops[0]).toMatchObject({ entityId: 'k1', entity: 'catalogItem', type: 'delete' });
  });
});
