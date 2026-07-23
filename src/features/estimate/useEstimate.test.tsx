import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { useAddItem, useRemoveItem, useCreateEstimate, useUpdateEstimate, ESTIMATE_KEY } from './useEstimate.ts';
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
      quantity: 2, unitPrice: 100, lineTotal: 200, sortOrder: 0, measurementRefs: [], quantityManual: false,
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
    onlineManager.setOnline(true); // rename is an online mutation
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
