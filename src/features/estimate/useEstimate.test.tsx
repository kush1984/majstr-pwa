import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import {
  useAddItem, useRemoveItem, useCreateEstimate, useUpdateEstimate, useDeleteEstimate,
  useAddItemFromCatalog, useAddItemsFromCatalogBatch, useMarkUpItems, ESTIMATE_KEY,
} from './useEstimate.ts';
import { clearOutbox, listOutbox } from '@/lib/outbox/outbox.ts';
import { estimatesApi } from '@/api/estimates.ts';
import type { EstimateResponse } from '@/api/types.ts';

vi.mock('@/api/estimates.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/estimates.ts')>();
  return { estimatesApi: { ...mod.estimatesApi, update: vi.fn() } };
});

// Drive the OFFLINE branch (optimistic estimate-cache edit + queued item op).
beforeEach(async () => { await clearOutbox(); onlineManager.setOnline(false); });
afterEach(() => onlineManager.setOnline(true));

const EID = 'est-1';

function seedEstimate(qc: QueryClient) {
  const est: EstimateResponse = {
    id: EID, projectId: 'p1', name: null, status: 'DRAFT', validUntil: null, notes: null,
    createdAt: '', updatedAt: '',
    items: [{
      id: 'i1', type: 'WORK', name: 'Робота', category: null, unit: 'M2',
      quantity: 2, unitPrice: 100, lineTotal: 200, sortOrder: 0, measurementRefs: [], quantityManual: false, percentBaseKind: null, percentBaseItemId: null, baseDetached: false, baseOriginLabel: null, closedByActs: null,
    }],
    worksSubtotal: 200, materialsSubtotal: 0, total: 200, depositAmount: null, balance: 200,
  };
  qc.setQueryData<EstimateResponse>([...ESTIMATE_KEY, EID], est);
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  seedEstimate(qc);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe('useEstimate items — offline authoring', () => {
  it('addItem: optimistically inserts the line, re-derives totals, queues a create op', async () => {
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useAddItem(EID), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ type: 'MATERIAL', name: 'Клей', unit: 'PIECE', quantity: 3, unitPrice: 50 });
    });

    const est = qc.getQueryData<EstimateResponse>([...ESTIMATE_KEY, EID])!;
    expect(est.items).toHaveLength(2);
    expect(est.materialsSubtotal).toBe(150); // 3 × 50
    expect(est.total).toBe(350);             // 200 works + 150 materials
    expect(est.balance).toBe(350);

    const ops = await listOutbox();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ entity: 'estimateItem', type: 'create', deps: [EID] });
    expect((ops[0].payload as { estimateId: string }).estimateId).toBe(EID);
  });

  it('createEstimate: seeds an empty optimistic estimate + summary, queues a create op on the project', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useCreateEstimate(), { wrapper });

    let est: EstimateResponse | undefined;
    await act(async () => { est = await result.current.mutateAsync({ projectId: 'p1', req: {} }); });

    expect(est?.id).toBeTruthy();
    expect(est?.status).toBe('DRAFT');
    // Detail cache seeded (so navigating to it works offline) + list summary prepended.
    expect(qc.getQueryData<EstimateResponse>([...ESTIMATE_KEY, est!.id])).toBeTruthy();
    expect(qc.getQueryData<{ id: string }[]>(['project-estimates', 'p1'])?.[0].id).toBe(est!.id);
    const ops = await listOutbox();
    expect(ops[0]).toMatchObject({ entity: 'estimate', type: 'create', entityId: est!.id, deps: ['p1'] });
  });

  it('removeItem: optimistically drops the line and re-derives totals to zero', async () => {
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useRemoveItem(EID), { wrapper });

    await act(async () => { await result.current.mutateAsync('i1'); });

    const est = qc.getQueryData<EstimateResponse>([...ESTIMATE_KEY, EID])!;
    expect(est.items).toHaveLength(0);
    expect(est.total).toBe(0);
    const ops = await listOutbox();
    expect(ops[0]).toMatchObject({ entity: 'estimateItem', type: 'delete', entityId: 'i1', deps: [EID] });
  });

  it('rename: invalidates the object screen summaries so the new name shows without a refresh', async () => {
    onlineManager.setOnline(true); // the ONLINE branch of the now offline-capable rename
    const { qc, wrapper } = setup();
    qc.setQueryData(['project-estimates', 'p1'], [{ id: EID, name: null }]);
    vi.mocked(estimatesApi.update).mockResolvedValue({} as EstimateResponse);
    const { result } = renderHook(() => useUpdateEstimate(EID), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ status: 'DRAFT', name: 'Нова назва' });
    });

    // The regression: the detail cache updated but the summaries list did not.
    expect(qc.getQueryState(['project-estimates', 'p1'])?.isInvalidated).toBe(true);
  });
});

describe('estimate fields + delete — offline', () => {
  it('queues a status change and patches the detail AND the object-screen summary', async () => {
    // Marking an estimate «Надіслано» on site is core work; this used to go straight to the
    // network. SIGNED never comes from here — only the portal can sign — so a queued status
    // change is always one the server will accept on replay.
    const { qc, wrapper } = setup();
    qc.setQueryData([...ESTIMATE_KEY, EID], { id: EID, status: 'DRAFT', name: null });
    qc.setQueryData(['project-estimates', 'p1'], [{ id: EID, status: 'DRAFT', name: null }]);
    const { result } = renderHook(() => useUpdateEstimate(EID), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ status: 'SENT', name: 'Економ' });
    });

    expect(qc.getQueryData<EstimateResponse>([...ESTIMATE_KEY, EID])!.status).toBe('SENT');
    expect(qc.getQueryData<{ status: string; name: string }[]>(['project-estimates', 'p1'])![0])
      .toMatchObject({ status: 'SENT', name: 'Економ' });
    const ops = await listOutbox();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ entity: 'estimate', entityId: EID, type: 'update' });
  });

  it('queues a delete and drops the estimate from the object screen', async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData(['project-estimates', 'p1'], [{ id: EID }, { id: 'est-2' }]);
    const { result } = renderHook(() => useDeleteEstimate(EID), { wrapper });

    await act(async () => { await result.current.mutateAsync(); });

    expect(qc.getQueryData<{ id: string }[]>(['project-estimates', 'p1'])!.map((e) => e.id))
      .toEqual(['est-2']);
    const ops = await listOutbox();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ entity: 'estimate', entityId: EID, type: 'delete' });
  });
});

describe('add from catalog — offline (how estimates are actually built)', () => {
  const CATALOG_LIST_KEY = ['catalog', 'list', 'all'];

  it('resolves the line from the CACHED catalog and queues one op per pick', async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData(CATALOG_LIST_KEY, [
      { id: 'c1', name: 'Розетка', category: 'Електрика', trade: 'ELECTRICAL',
        type: 'WORK', unit: 'PIECE', defaultPrice: 180, createdAt: '' },
    ]);
    qc.setQueryData([...ESTIMATE_KEY, EID], {
      id: EID, status: 'DRAFT', items: [], worksSubtotal: 0, materialsSubtotal: 0, total: 0, balance: 0,
    });
    const { result } = renderHook(() => useAddItemFromCatalog(EID), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ catalogItemId: 'c1', req: { quantity: 3 } });
    });

    // The master sees a real line, not a placeholder — name/unit/price copied from the cache,
    // and the totals re-derived by the same arithmetic the server uses.
    const est = qc.getQueryData<EstimateResponse>([...ESTIMATE_KEY, EID])!;
    expect(est.items).toHaveLength(1);
    expect(est.items[0]).toMatchObject({ name: 'Розетка', unit: 'PIECE', unitPrice: 180, quantity: 3 });
    expect(est.total).toBe(540);

    const ops = await listOutbox();
    expect(ops).toHaveLength(1);
    // Replayed through the FROM-CATALOG endpoint, not the plain item add: a catalog position
    // may legally cost 0, which the validated add form would reject on replay.
    expect(ops[0]).toMatchObject({ entity: 'estimateItemFromCatalog', type: 'create', deps: [EID] });
  });

  it('keeps a multi-select as ONE op, with a client id per line', async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData(CATALOG_LIST_KEY, [
      { id: 'c1', name: 'Розетка', category: null, trade: null, type: 'WORK', unit: 'PIECE', defaultPrice: 100, createdAt: '' },
      { id: 'c2', name: 'Кабель', category: null, trade: null, type: 'MATERIAL', unit: 'M', defaultPrice: 40, createdAt: '' },
    ]);
    qc.setQueryData([...ESTIMATE_KEY, EID], {
      id: EID, status: 'DRAFT', items: [], worksSubtotal: 0, materialsSubtotal: 0, total: 0, balance: 0,
    });
    const { result } = renderHook(() => useAddItemsFromCatalogBatch(EID), { wrapper });

    await act(async () => {
      await result.current.mutateAsync([
        { catalogItemId: 'c1', quantity: 2 },
        { catalogItemId: 'c2', quantity: 5 },
      ]);
    });

    const est = qc.getQueryData<EstimateResponse>([...ESTIMATE_KEY, EID])!;
    expect(est.items).toHaveLength(2);
    expect(est.worksSubtotal).toBe(200);
    expect(est.materialsSubtotal).toBe(200);

    const ops = await listOutbox();
    expect(ops).toHaveLength(1); // ONE op, not two — online it stays a single round trip
    const payload = ops[0].payload as { items: { id?: string }[] };
    expect(payload.items).toHaveLength(2);
    // Per-line ids: a partially-applied batch resumes instead of duplicating what landed.
    expect(new Set(payload.items.map((i) => i.id)).size).toBe(2);
  });

  it('skips the optimistic line when the catalog is not cached, but still queues the add', async () => {
    // Honesty over invention: without the catalog we cannot know the name or price, so we show
    // nothing rather than a fake line. The server still copies it correctly on replay.
    const { qc, wrapper } = setup();
    qc.setQueryData([...ESTIMATE_KEY, EID], {
      id: EID, status: 'DRAFT', items: [], worksSubtotal: 0, materialsSubtotal: 0, total: 0, balance: 0,
    });
    const { result } = renderHook(() => useAddItemFromCatalog(EID), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ catalogItemId: 'unknown', req: { quantity: 1 } });
    });

    expect(qc.getQueryData<EstimateResponse>([...ESTIMATE_KEY, EID])!.items).toHaveLength(0);
    expect(await listOutbox()).toHaveLength(1);
  });
});

describe('markup on the picked lines — offline («Націнка на вибрані позиції»)', () => {
  it('moves the UNIT price of every picked line, re-derives totals, queues ONE op', async () => {
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useMarkUpItems(EID), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ itemIds: ['i1'], percent: 15, discount: false });
    });

    const est = qc.getQueryData<EstimateResponse>([...ESTIMATE_KEY, EID])!;
    // Rounded to the whole hryvnia on the UNIT price, the way the server rounds it — round the
    // line total instead and the two drift apart the moment a quantity is not 1.
    expect(est.items[0].unitPrice).toBe(115);
    expect(est.items[0].lineTotal).toBe(230); // 2 × 115, re-derived rather than carried
    expect(est.total).toBe(230);

    // ONE op for the whole selection, like the bulk delete: a replay that stopped half-way would
    // leave him an estimate he has already stopped checking.
    const ops = await listOutbox();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      entity: 'estimateItemsMarkup', type: 'update', entityId: EID, deps: [EID],
    });
    expect((ops[0].payload as { req: { itemIds: string[] } }).req.itemIds).toEqual(['i1']);
  });

  it('applies a discount downwards, from the same unsigned magnitude', async () => {
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useMarkUpItems(EID), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ itemIds: ['i1'], percent: 10, discount: true });
    });

    const est = qc.getQueryData<EstimateResponse>([...ESTIMATE_KEY, EID])!;
    expect(est.items[0].unitPrice).toBe(90); // 100 × 0.9 — a discount is a markup with a minus
    expect(est.items[0].lineTotal).toBe(180);
  });

  it('leaves a «%» line alone even when it is picked, and lets it lift with its base instead', async () => {
    // A CONSOLIDATION-FROZEN percent line (V92): `percentBaseKind: null` defaults `kindOf` to
    // MANUAL, which is the one shape that reads `unitPrice` AS its base — so it is the only place
    // where marking a «%» line up is actually observable. Mark it up and the master would be
    // charging 15 % more on top of a base that already grew: the double-apply the server's
    // `Unit.PERCENT` filter exists to prevent.
    const { qc, wrapper } = setup();
    qc.setQueryData([...ESTIMATE_KEY, EID], {
      id: EID, status: 'DRAFT',
      items: [
        {
          id: 'i1', type: 'WORK', name: 'Робота', category: null, unit: 'M2',
          quantity: 2, unitPrice: 100, lineTotal: 200, sortOrder: 0, measurementRefs: [],
          quantityManual: false, percentBaseKind: null, percentBaseItemId: null,
          baseDetached: false, baseOriginLabel: null, closedByActs: null,
        },
        {
          id: 'p1', type: 'WORK', name: 'Доставка', category: null, unit: 'PERCENT',
          quantity: 10, unitPrice: 500, lineTotal: 50, sortOrder: 1, measurementRefs: [],
          quantityManual: false, percentBaseKind: null, percentBaseItemId: null,
          baseDetached: false, baseOriginLabel: 'Роботи', closedByActs: null,
        },
      ],
      worksSubtotal: 250, materialsSubtotal: 0, total: 250, balance: 250,
    });
    const { result } = renderHook(() => useMarkUpItems(EID), { wrapper });

    await act(async () => {
      // Both are picked — the board cannot tick a «%» row, but the request must hold the line anyway.
      await result.current.mutateAsync({ itemIds: ['i1', 'p1'], percent: 15, discount: false });
    });

    const est = qc.getQueryData<EstimateResponse>([...ESTIMATE_KEY, EID])!;
    expect(est.items[0].unitPrice).toBe(115);
    expect(est.items[1].unitPrice).toBe(500); // untouched: 575 would be the double-apply
    expect(est.items[1].lineTotal).toBe(50);
  });
});
