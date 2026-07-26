import 'fake-indexeddb/auto';
import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import {
  ESTIMATE_TEMPLATE_KEY,
  useAddTemplateItem,
  useDeleteTemplate,
  useRemoveTemplateItem,
  useRenameTemplate,
} from './useEstimateTemplates.ts';
import { clearOutbox, listOutbox } from '@/lib/outbox/outbox.ts';
import type { EstimateTemplateDetail, EstimateTemplateSummary } from '@/api/types.ts';

beforeEach(async () => { await clearOutbox(); onlineManager.setOnline(false); });
afterEach(() => onlineManager.setOnline(true));

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

const detailKey = (id: string) => [...ESTIMATE_TEMPLATE_KEY, id];

function seed(qc: QueryClient) {
  qc.setQueryData<EstimateTemplateSummary[]>(ESTIMATE_TEMPLATE_KEY, [
    { id: 't1', name: 'Санвузол', trade: 'PLUMBING', isDefault: false, itemCount: 1 },
  ]);
  qc.setQueryData<EstimateTemplateDetail>(detailKey('t1'), {
    id: 't1', name: 'Санвузол', trade: 'PLUMBING', isDefault: false,
    items: [{ id: 'i1', name: 'Монтаж унітаза', type: 'WORK', unit: 'PIECE', sortOrder: 0 }],
  });
}

describe('useEstimateTemplates — offline authoring (queued)', () => {
  it('rename: patches the list row and the detail, and queues an update op', async () => {
    const { qc, wrapper } = setup();
    seed(qc);
    const { result } = renderHook(() => useRenameTemplate(), { wrapper });

    await act(async () => { await result.current.mutateAsync({ id: 't1', name: 'Ванна' }); });

    expect(qc.getQueryData<EstimateTemplateSummary[]>(ESTIMATE_TEMPLATE_KEY)?.[0].name).toBe('Ванна');
    expect(qc.getQueryData<EstimateTemplateDetail>(detailKey('t1'))?.name).toBe('Ванна');
    const ops = await listOutbox();
    expect(ops[0]).toMatchObject({ entityId: 't1', entity: 'estimateTemplate', type: 'update' });
    expect(ops[0].payload).toMatchObject({ op: 'rename', name: 'Ванна' });
  });

  it('addItem: appends to the detail, bumps the row count, queues a create with the item UUID', async () => {
    const { qc, wrapper } = setup();
    seed(qc);
    const { result } = renderHook(() => useAddTemplateItem('t1'), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ name: 'Монтаж змішувача', type: 'WORK', unit: 'PIECE' });
    });

    const detail = qc.getQueryData<EstimateTemplateDetail>(detailKey('t1'));
    expect(detail?.items.map((i) => i.name)).toEqual(['Монтаж унітаза', 'Монтаж змішувача']);
    expect(detail?.items[1].sortOrder).toBe(1);
    expect(qc.getQueryData<EstimateTemplateSummary[]>(ESTIMATE_TEMPLATE_KEY)?.[0].itemCount).toBe(2);

    const ops = await listOutbox();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ entity: 'templateItem', type: 'create' });
    expect(ops[0].entityId).toBe(detail!.items[1].id);
    expect(ops[0].payload).toMatchObject({ templateId: 't1' });
  });

  it('removeItem: drops it from the detail and queues a delete op', async () => {
    const { qc, wrapper } = setup();
    seed(qc);
    const { result } = renderHook(() => useRemoveTemplateItem('t1'), { wrapper });

    await act(async () => { await result.current.mutateAsync('i1'); });

    expect(qc.getQueryData<EstimateTemplateDetail>(detailKey('t1'))?.items).toEqual([]);
    expect(qc.getQueryData<EstimateTemplateSummary[]>(ESTIMATE_TEMPLATE_KEY)?.[0].itemCount).toBe(0);
    const ops = await listOutbox();
    expect(ops[0]).toMatchObject({ entityId: 'i1', entity: 'templateItem', type: 'delete' });
  });

  it('delete: removes the template from the list and queues a delete op', async () => {
    const { qc, wrapper } = setup();
    seed(qc);
    const { result } = renderHook(() => useDeleteTemplate(), { wrapper });

    await act(async () => { await result.current.mutateAsync('t1'); });

    expect(qc.getQueryData<EstimateTemplateSummary[]>(ESTIMATE_TEMPLATE_KEY)).toEqual([]);
    const ops = await listOutbox();
    expect(ops[0]).toMatchObject({ entityId: 't1', entity: 'estimateTemplate', type: 'delete' });
  });
});
