import 'fake-indexeddb/auto';
import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { useShoppingActions, SHOPPING_KEY, SHOPPING_SUMMARY_KEY } from './useShoppingList.ts';
import { clearOutbox, listOutbox } from '@/lib/outbox/outbox.ts';
import type {
  ShoppingListItemResponse,
  ShoppingListResponse,
  ShoppingListSummaryResponse,
} from '@/api/types.ts';

/**
 * The list is used in a builders' merchant — a basement or a metal shed — so every action on this
 * screen has to work with no signal at all, ticking a row included. These tests pin that, and the
 * thing that is easy to break: the home card's counts are patched from the SAME write, so a row
 * ticked offline does not still read «12 позицій» on the home screen.
 */
beforeEach(async () => { await clearOutbox(); onlineManager.setOnline(false); });
afterEach(() => onlineManager.setOnline(true));

const OBJ = 'p1';

function item(over: Partial<ShoppingListItemResponse>): ShoppingListItemResponse {
  return {
    id: 'i1',
    materialId: null,
    name: 'Профіль CD',
    unit: 'PIECE',
    quantity: 12,
    bought: false,
    boughtAt: null,
    edited: false,
    suggestedQuantity: null,
    topUp: false,
    source: 'CALCULATOR',
    sourceEstimateId: null,
    note: null,
    sortOrder: 0,
    ...over,
  };
}

function setup(items: ShoppingListItemResponse[]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const list: ShoppingListResponse = {
    id: 'l1',
    projectId: OBJ,
    projectName: 'Квартира',
    archivedAt: null,
    totalCount: items.length,
    boughtCount: items.filter((i) => i.bought).length,
    sourceEstimateUnsigned: false,
    items,
  };
  qc.setQueryData<ShoppingListResponse>(SHOPPING_KEY(OBJ), list);
  qc.setQueryData<ShoppingListSummaryResponse[]>(SHOPPING_SUMMARY_KEY, [
    { projectId: OBJ, projectName: 'Квартира', totalCount: list.totalCount, boughtCount: list.boughtCount },
    { projectId: 'p2', projectName: 'Офіс', totalCount: 3, boughtCount: 0 },
  ]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

const listOf = (qc: QueryClient) => qc.getQueryData<ShoppingListResponse>(SHOPPING_KEY(OBJ))!;
const cardOf = (qc: QueryClient) => qc.getQueryData<ShoppingListSummaryResponse[]>(SHOPPING_SUMMARY_KEY)!;

describe('useShoppingActions — offline', () => {
  it('ticks a row offline and keeps the home card in step', async () => {
    const { qc, wrapper } = setup([item({ id: 'a' }), item({ id: 'b', name: 'Профіль UD', sortOrder: 1 })]);
    const { result } = renderHook(() => useShoppingActions(OBJ), { wrapper });

    await act(async () => {
      await result.current.update.mutateAsync({ itemId: 'a', req: { bought: true } });
    });

    const list = listOf(qc);
    expect(list.items.find((i) => i.id === 'a')!.bought).toBe(true);
    expect(list.items.find((i) => i.id === 'a')!.boughtAt).toBeTruthy();
    expect(list.boughtCount).toBe(1);
    expect(cardOf(qc).find((s) => s.projectId === OBJ)).toMatchObject({ totalCount: 2, boughtCount: 1 });

    const ops = await listOutbox();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ entity: 'shoppingItem', entityId: 'a', type: 'update' });
  });

  it('drops the object off the home card once nothing is left to buy', async () => {
    const { qc, wrapper } = setup([item({ id: 'a' })]);
    const { result } = renderHook(() => useShoppingActions(OBJ), { wrapper });

    await act(async () => {
      await result.current.update.mutateAsync({ itemId: 'a', req: { bought: true } });
    });

    expect(cardOf(qc).map((s) => s.projectId)).toEqual(['p2']);
  });

  it('marks a hand-typed quantity edited, so a recalculation cannot overwrite it', async () => {
    const { qc, wrapper } = setup([item({ id: 'a' })]);
    const { result } = renderHook(() => useShoppingActions(OBJ), { wrapper });

    await act(async () => {
      await result.current.update.mutateAsync({ itemId: 'a', req: { quantity: 14 } });
    });

    expect(listOf(qc).items[0]).toMatchObject({ quantity: 14, edited: true, bought: false });
  });

  it('takes the parked figure offline exactly as the server would', async () => {
    const { qc, wrapper } = setup([item({ id: 'a', quantity: 9, edited: true, suggestedQuantity: 20 })]);
    const { result } = renderHook(() => useShoppingActions(OBJ), { wrapper });

    await act(async () => {
      await result.current.update.mutateAsync({ itemId: 'a', req: { suggestion: 'ACCEPT' } });
    });

    // The op carries no number: both sides read the suggestion off the row, so a replay days later
    // cannot apply a figure the master never saw.
    expect(listOf(qc).items[0]).toMatchObject({ quantity: 20, edited: false, suggestedQuantity: null });
    expect((await listOutbox())[0]).toMatchObject({ entity: 'shoppingItem', entityId: 'a', type: 'update' });
  });

  it('keeps his own number when he refuses the offer', async () => {
    const { qc, wrapper } = setup([item({ id: 'a', quantity: 9, edited: true, suggestedQuantity: 20 })]);
    const { result } = renderHook(() => useShoppingActions(OBJ), { wrapper });

    await act(async () => {
      await result.current.update.mutateAsync({ itemId: 'a', req: { suggestion: 'KEEP_MINE' } });
    });

    expect(listOf(qc).items[0]).toMatchObject({ quantity: 9, edited: true, suggestedQuantity: null });
  });

  it('queues an add against the object, under the id the row was given', async () => {
    const { qc, wrapper } = setup([item({ id: 'a' })]);
    const { result } = renderHook(() => useShoppingActions(OBJ), { wrapper });

    await act(async () => {
      await result.current.add.mutateAsync({ name: 'Саморізи', unit: 'PIECE', quantity: 200 });
    });

    const list = listOf(qc);
    expect(list.items.map((i) => i.name)).toEqual(['Профіль CD', 'Саморізи']);
    expect(list.items[1]).toMatchObject({ source: 'MANUAL', bought: false, edited: false });
    expect(list.totalCount).toBe(2);

    const ops = await listOutbox();
    // deps on the object: a list authored on a freshly-created offline object must not be sent
    // before that object exists on the server. The op id IS the row id, so a replay cannot double it.
    expect(ops[0]).toMatchObject({ entity: 'shoppingItem', type: 'create', deps: [OBJ] });
    expect(ops[0].entityId).toBe(list.items[1].id);
  });

  it('removes a row offline', async () => {
    const { qc, wrapper } = setup([item({ id: 'a' }), item({ id: 'b', sortOrder: 1 })]);
    const { result } = renderHook(() => useShoppingActions(OBJ), { wrapper });

    await act(async () => { await result.current.remove.mutateAsync('b'); });

    expect(listOf(qc).items.map((i) => i.id)).toEqual(['a']);
    expect((await listOutbox())[0]).toMatchObject({ entity: 'shoppingItem', entityId: 'b', type: 'delete' });
  });

  it('coalesces two taps on «прибрати куплені» into one op', async () => {
    const { qc, wrapper } = setup([
      item({ id: 'a', bought: true }),
      item({ id: 'b', sortOrder: 1 }),
      item({ id: 'c', bought: true, sortOrder: 2 }),
    ]);
    const { result } = renderHook(() => useShoppingActions(OBJ), { wrapper });

    await act(async () => { await result.current.clearBought.mutateAsync(); });
    await act(async () => { await result.current.clearBought.mutateAsync(); });

    expect(listOf(qc).items.map((i) => i.id)).toEqual(['b']);
    const ops = await listOutbox();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ entity: 'shoppingClear', entityId: OBJ, type: 'update' });
  });
});
