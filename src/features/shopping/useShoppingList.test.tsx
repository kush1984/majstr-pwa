import 'fake-indexeddb/auto';
import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { useShoppingActions, SHOPPING_KEY, SHOPPING_SUMMARY_KEY } from './useShoppingList.ts';
import { clearOutbox, listOutbox } from '@/lib/outbox/outbox.ts';
import { toast } from '@/hooks/useToast.ts';
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
const api = vi.hoisted(() => ({
  add: vi.fn(), update: vi.fn(), remove: vi.fn(), clearBought: vi.fn(),
}));
vi.mock('@/api/shopping.ts', () => ({ shoppingApi: api }));

beforeEach(async () => {
  await clearOutbox();
  onlineManager.setOnline(false);
  for (const fn of Object.values(api)) fn.mockReset();
});
afterEach(() => {
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});

const OBJ = 'p1';

/** A real refusal from the server — `response` present, so it is NOT a network blip to be queued. */
function serverSaid(status: number, message: string): Error {
  return Object.assign(new Error(message), {
    isAxiosError: true,
    response: { status, data: { status, message } },
  });
}

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

  /**
   * A row added and then dealt with in the same basement has no server row yet — its create is still
   * in the outbox. Stacking a second op behind it sends the server two round trips to arrive where
   * the master already is, and in the delete case the first of them spends a row on his object.
   */
  it('a row added and removed offline leaves nothing at all to replay', async () => {
    const { qc, wrapper } = setup([]);
    const { result } = renderHook(() => useShoppingActions(OBJ), { wrapper });

    await act(async () => {
      await result.current.add.mutateAsync({ name: 'Саморізи', unit: 'PIECE', quantity: 200 });
    });
    const id = listOf(qc).items[0].id;
    await act(async () => { await result.current.remove.mutateAsync(id); });

    expect(listOf(qc).items).toHaveLength(0);
    // Not «a create and a delete that cancel out» — nothing. A POST-then-DELETE replay would have
    // counted against the object's rows and raced anything that read the list in between.
    expect(await listOutbox()).toHaveLength(0);
  });

  it('folds a correction into the row’s own queued create instead of stacking a PATCH', async () => {
    const { qc, wrapper } = setup([]);
    const { result } = renderHook(() => useShoppingActions(OBJ), { wrapper });

    await act(async () => {
      await result.current.add.mutateAsync({ name: 'Саморізи', unit: 'PIECE', quantity: 200 });
    });
    const id = listOf(qc).items[0].id;
    await act(async () => {
      await result.current.update.mutateAsync({ itemId: id, req: { quantity: 250, note: 'чорні' } });
    });

    const ops = await listOutbox();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: 'create', entityId: id });
    expect(ops[0].payload).toMatchObject({ req: { quantity: 250, note: 'чорні' } });
    // The screen agrees with what will be sent.
    expect(listOf(qc).items[0]).toMatchObject({ quantity: 250, note: 'чорні' });
  });

  it('but a tick on that row keeps its own op — the create replays under the row’s id', async () => {
    // Unlike an act receipt, `shoppingApi.add` sends the row id as `X-Entity-Uuid`, so the server
    // row the create makes is precisely the one the PATCH behind it addresses. Nothing to fold:
    // `bought` is not a field of the create request.
    const { qc, wrapper } = setup([]);
    const { result } = renderHook(() => useShoppingActions(OBJ), { wrapper });

    await act(async () => {
      await result.current.add.mutateAsync({ name: 'Саморізи', unit: 'PIECE', quantity: 200 });
    });
    const id = listOf(qc).items[0].id;
    await act(async () => { await result.current.toggle.mutateAsync(id); });

    const ops = await listOutbox();
    expect(ops.map((o) => o.type)).toEqual(['create', 'update']);
    expect(listOf(qc).items[0].bought).toBe(true);
  });

  it('puts the object back on the home card when the last settled row is un-ticked', async () => {
    const { qc, wrapper } = setup([item({ id: 'a', bought: true, boughtAt: '2026-09-01T10:00:00Z' })]);
    // The server omits a finished list from the card, so this is the state he is actually looking at.
    qc.setQueryData<ShoppingListSummaryResponse[]>(SHOPPING_SUMMARY_KEY, [
      { projectId: 'p2', projectName: 'Офіс', totalCount: 3, boughtCount: 0 },
    ]);
    const { result } = renderHook(() => useShoppingActions(OBJ), { wrapper });

    await act(async () => { await result.current.toggle.mutateAsync('a'); });

    // Patching by `map` alone could only ever SHRINK the card, so «🛒 Купити» quietly went on
    // missing the object he was standing in front of until some later fetch corrected it.
    expect(cardOf(qc).map((s) => s.projectId)).toEqual(['p2', OBJ]);
    expect(cardOf(qc).find((s) => s.projectId === OBJ)).toMatchObject({ totalCount: 1, boughtCount: 0 });
  });

  it('leaves the object where it already sat on the card', async () => {
    const { qc, wrapper } = setup([item({ id: 'a' }), item({ id: 'b', sortOrder: 1 })]);
    const { result } = renderHook(() => useShoppingActions(OBJ), { wrapper });

    await act(async () => { await result.current.toggle.mutateAsync('a'); });

    // The card's order is the server's; a row that jumped to the bottom every time it was touched
    // reads as a different object.
    expect(cardOf(qc).map((s) => s.projectId)).toEqual([OBJ, 'p2']);
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

describe('useShoppingActions — online', () => {
  beforeEach(() => onlineManager.setOnline(true));

  it('shows the tick at once, not only after the refetch lands', async () => {
    // The patch used to be handed to `offlineMutate` as its `optimistic` callback, which runs ONLY
    // on the queued path — so WITH a signal the row sat still and the master tapped it again.
    const { qc, wrapper } = setup([item({ id: 'a' })]);
    const { result } = renderHook(() => useShoppingActions(OBJ), { wrapper });

    await act(async () => { await result.current.toggle.mutateAsync('a'); });

    expect(api.update).toHaveBeenCalledWith(OBJ, 'a', { bought: true });
    expect(listOf(qc).items[0].bought).toBe(true);
    expect(listOf(qc).boughtCount).toBe(1);
    expect(await listOutbox()).toHaveLength(0); // online writes do not queue
  });

  it('says so when the server refuses a PATCH, and puts the row back', async () => {
    const errors = vi.spyOn(toast, 'error');
    api.update.mockRejectedValue(serverSaid(400, 'Рядок уже змінено'));
    const { qc, wrapper } = setup([item({ id: 'a' })]);
    const { result } = renderHook(() => useShoppingActions(OBJ), { wrapper });

    await act(async () => {
      await expect(result.current.toggle.mutateAsync('a')).rejects.toThrow();
    });

    // Silence was the bug: the row looked saved and he walked out without the material.
    expect(errors).toHaveBeenCalledWith('Рядок уже змінено');
    expect(listOf(qc).items[0].bought).toBe(false);
    expect(listOf(qc).items[0].boughtAt).toBeNull();
    expect(listOf(qc).boughtCount).toBe(0);
    expect(cardOf(qc).find((s) => s.projectId === OBJ)).toMatchObject({ totalCount: 1, boughtCount: 0 });
    expect(await listOutbox()).toHaveLength(0); // a refusal is not something to retry later
  });

  it('rolls the row back off a refused add, so a line he cannot save does not linger', async () => {
    const errors = vi.spyOn(toast, 'error');
    api.add.mockRejectedValue(serverSaid(400, 'Задовга назва'));
    const { qc, wrapper } = setup([item({ id: 'a' })]);
    const { result } = renderHook(() => useShoppingActions(OBJ), { wrapper });

    await act(async () => {
      await expect(result.current.add.mutateAsync({
        name: 'Саморізи', unit: 'PIECE', quantity: 200,
      })).rejects.toThrow();
    });

    expect(errors).toHaveBeenCalledWith('Задовга назва');
    expect(listOf(qc).items.map((i) => i.id)).toEqual(['a']);
    expect(listOf(qc).totalCount).toBe(1);
  });

  it('decides which way to tick from the cache, never from the screen that asked', async () => {
    // The page sent `!item.bought` off its render closure. On a list that had moved underneath it —
    // a sync landing, a second tap on a laggy screen — that said «make it bought» about a row that
    // already was, and the write landed as an undo of whatever had changed it.
    const { qc, wrapper } = setup([item({ id: 'a', bought: true, boughtAt: '2026-09-01T10:00:00Z' })]);
    const { result } = renderHook(() => useShoppingActions(OBJ), { wrapper });

    await act(async () => { await result.current.toggle.mutateAsync('a'); });

    expect(api.update).toHaveBeenCalledWith(OBJ, 'a', { bought: false });
    expect(listOf(qc).items[0]).toMatchObject({ bought: false, boughtAt: null });
  });

  it('a network blip is not a refusal — the write queues and the row stays ticked', async () => {
    // No `response`: the request never got an answer, which `offlineMutate` treats as offline.
    api.update.mockRejectedValue(Object.assign(new Error('Network Error'), { isAxiosError: true }));
    const { qc, wrapper } = setup([item({ id: 'a' })]);
    const { result } = renderHook(() => useShoppingActions(OBJ), { wrapper });

    await act(async () => { await result.current.toggle.mutateAsync('a'); });

    expect(listOf(qc).items[0].bought).toBe(true);
    expect((await listOutbox())[0]).toMatchObject({ entity: 'shoppingItem', entityId: 'a' });
  });
});
