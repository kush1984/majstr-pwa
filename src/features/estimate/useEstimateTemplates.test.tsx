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
  useReorderTemplateItems,
  useUpdateTemplateItem,
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
    { id: 't1', name: 'Санвузол', trade: 'PLUMBING', customTradeId: null, customTradeName: null, isDefault: false, itemCount: 1 },
  ]);
  qc.setQueryData<EstimateTemplateDetail>(detailKey('t1'), {
    id: 't1', name: 'Санвузол', trade: 'PLUMBING', customTradeId: null, customTradeName: null, isDefault: false,
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

describe('useEstimateTemplates — editing a position and its order (offline)', () => {
  function seedTwo(qc: QueryClient) {
    qc.setQueryData<EstimateTemplateSummary[]>(ESTIMATE_TEMPLATE_KEY, [
      { id: 't1', name: 'Санвузол', trade: 'PLUMBING', customTradeId: null, customTradeName: null, isDefault: false, itemCount: 2 },
    ]);
    qc.setQueryData<EstimateTemplateDetail>(detailKey('t1'), {
      id: 't1', name: 'Санвузол', trade: 'PLUMBING', customTradeId: null, customTradeName: null, isDefault: false,
      items: [
        { id: 'i1', name: 'Монтаж унітаза', type: 'WORK', unit: 'PIECE', sortOrder: 0 },
        { id: 'i2', name: 'Монтаж змішувача', type: 'WORK', unit: 'PIECE', sortOrder: 1 },
      ],
    });
  }

  it('updateItem: rewrites the position in place and queues an update op', async () => {
    const { qc, wrapper } = setup();
    seedTwo(qc);
    const { result } = renderHook(() => useUpdateTemplateItem('t1'), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        itemId: 'i1', req: { name: 'Демонтаж унітаза', type: 'WORK', unit: 'PIECE' },
      });
    });

    const detail = qc.getQueryData<EstimateTemplateDetail>(detailKey('t1'));
    expect(detail?.items.map((i) => i.name)).toEqual(['Демонтаж унітаза', 'Монтаж змішувача']);
    // The count is untouched — an edit is not an add.
    expect(qc.getQueryData<EstimateTemplateSummary[]>(ESTIMATE_TEMPLATE_KEY)?.[0].itemCount).toBe(2);

    const ops = await listOutbox();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ entityId: 'i1', entity: 'templateItem', type: 'update' });
    expect(ops[0].payload).toMatchObject({
      templateId: 't1', req: { name: 'Демонтаж унітаза', type: 'WORK', unit: 'PIECE' },
    });
  });

  it('reorder: renumbers the detail and queues ONE op carrying the whole final order', async () => {
    const { qc, wrapper } = setup();
    seedTwo(qc);
    const { result } = renderHook(() => useReorderTemplateItems('t1'), { wrapper });
    const items = qc.getQueryData<EstimateTemplateDetail>(detailKey('t1'))!.items;

    // Dragged twice offline: reversed, then back. The master wants the LAST arrangement, and the
    // request states the whole order anyway, so replaying the abandoned one buys nothing.
    await act(async () => { await result.current.mutateAsync([items[1], items[0]]); });
    await act(async () => { await result.current.mutateAsync([items[0], items[1]]); });

    const detail = qc.getQueryData<EstimateTemplateDetail>(detailKey('t1'));
    expect(detail?.items.map((i) => i.id)).toEqual(['i1', 'i2']);
    expect(detail?.items.map((i) => i.sortOrder)).toEqual([0, 1]);

    const ops = await listOutbox();
    expect(ops).toHaveLength(1);
    // Its OWN entity, not an estimateTemplate update: coalescing keys on entity+entityId+type, so
    // sharing that entity would let a reorder swallow a queued rename.
    expect(ops[0]).toMatchObject({ entityId: 't1', entity: 'templateItemOrder', type: 'update' });
    expect(ops[0].payload).toMatchObject({ req: { itemIds: ['i1', 'i2'] } });
  });
});

/**
 * V121 — the bundle carries the paragraph the client reads under his table, and `description` is
 * THREE-valued on the way to the server: absent = leave it as it is, blank = clear, text = write.
 * A rename is the common write, and it must never be able to drop a paragraph it never knew about
 * — least of all on an offline replay, where the op that lands is the only thing the server sees.
 */
describe('useEstimateTemplates — the paragraph the client reads (V121)', () => {
  const Q4 = 'Q4 — під глянець і бокове світло. Контроль ковзним світлом: 6 точок.';

  function seedDescribed(qc: QueryClient) {
    qc.setQueryData<EstimateTemplateSummary[]>(ESTIMATE_TEMPLATE_KEY, [
      { id: 't1', name: 'Підготовка ГКЛ · Q4', description: Q4, trade: 'DRYWALL', customTradeId: null, customTradeName: null, isDefault: false, itemCount: 1 },
    ]);
    qc.setQueryData<EstimateTemplateDetail>(detailKey('t1'), {
      id: 't1', name: 'Підготовка ГКЛ · Q4', description: Q4, trade: 'DRYWALL', customTradeId: null, customTradeName: null, isDefault: false,
      items: [{ id: 'i1', name: 'Грунтування', type: 'WORK', unit: 'M2', sortOrder: 0 }],
    });
  }

  it('a plain rename queues no description at all — and keeps the cached one', async () => {
    const { qc, wrapper } = setup();
    seedDescribed(qc);
    const { result } = renderHook(() => useRenameTemplate(), { wrapper });

    await act(async () => { await result.current.mutateAsync({ id: 't1', name: 'Q4 — стеля' }); });

    expect(qc.getQueryData<EstimateTemplateDetail>(detailKey('t1'))?.description).toBe(Q4);
    const [op] = await listOutbox();
    // Not `description: null` — the KEY has to be missing, or the replay clears the paragraph.
    expect(Object.hasOwn(op.payload as object, 'description')).toBe(false);
  });

  it('carries a rewritten paragraph in the same op as the name', async () => {
    const { qc, wrapper } = setup();
    seedDescribed(qc);
    const { result } = renderHook(() => useRenameTemplate(), { wrapper });
    const rewritten = 'Q4 — плюс шліфування під бокове світло.';

    await act(async () => {
      await result.current.mutateAsync({ id: 't1', name: 'Підготовка ГКЛ · Q4', description: rewritten });
    });

    expect(qc.getQueryData<EstimateTemplateDetail>(detailKey('t1'))?.description).toBe(rewritten);
    expect(qc.getQueryData<EstimateTemplateSummary[]>(ESTIMATE_TEMPLATE_KEY)?.[0].description).toBe(rewritten);
    const ops = await listOutbox();
    expect(ops).toHaveLength(1); // one door for the template's metadata, not two round trips
    expect(ops[0].payload).toMatchObject({ op: 'rename', description: rewritten });
  });

  it('an emptied field clears it, which is a different thing from saying nothing', async () => {
    const { qc, wrapper } = setup();
    seedDescribed(qc);
    const { result } = renderHook(() => useRenameTemplate(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 't1', name: 'Підготовка ГКЛ · Q4', description: '' });
    });

    expect(qc.getQueryData<EstimateTemplateDetail>(detailKey('t1'))?.description).toBeNull();
    expect((await listOutbox())[0].payload).toMatchObject({ description: '' });
  });
});
