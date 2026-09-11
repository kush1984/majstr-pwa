import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { shoppingApi } from '@/api/shopping.ts';
import { newUuid } from '@/lib/uuid.ts';
import { offlineMutate } from '@/lib/outbox/offlineMutation.ts';
import type {
  ShoppingListItemRequest,
  ShoppingListItemResponse,
  ShoppingListItemUpdateRequest,
  ShoppingListResponse,
  ShoppingListSummaryResponse,
} from '@/api/types.ts';

/** Exported so the offline prefetch primes the SAME keys these hooks read. */
export const SHOPPING_KEY = (projectId: string) => ['shopping-list', projectId] as const;
export const SHOPPING_SUMMARY_KEY = ['shopping-lists', 'summary'] as const;

/** The object's list. FREE on every plan — deciding how much to buy is not a premium question. */
export function useShoppingList(projectId: string) {
  return useQuery({
    queryKey: SHOPPING_KEY(projectId),
    queryFn: () => shoppingApi.get(projectId),
    enabled: Boolean(projectId),
  });
}

/** The home-screen «🛒 Купити» card. Lists with nothing left to buy are not returned at all. */
export function useShoppingSummary() {
  return useQuery({
    queryKey: SHOPPING_SUMMARY_KEY,
    queryFn: () => shoppingApi.summary(),
  });
}

/** Counts are derived, never carried: one place decides what «3 куплено» means. */
function recount(list: ShoppingListResponse, items: ShoppingListItemResponse[]): ShoppingListResponse {
  return {
    ...list,
    items,
    totalCount: items.length,
    boughtCount: items.filter((i) => i.bought).length,
  };
}

/**
 * Every write on this screen — offline-first, because this screen is USED offline. The merchant's
 * counter is a basement; ticking a row there is the whole point of the feature, so nothing here
 * may need the network. Adds carry a client id so a replay cannot double a row.
 */
export function useShoppingActions(projectId: string) {
  const qc = useQueryClient();

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: SHOPPING_KEY(projectId) });
    void qc.invalidateQueries({ queryKey: SHOPPING_SUMMARY_KEY });
  };

  /** Patch the cached list AND the home card, so an offline tick is visible on both screens. */
  const patch = (edit: (items: ShoppingListItemResponse[]) => ShoppingListItemResponse[]) => {
    const old = qc.getQueryData<ShoppingListResponse>(SHOPPING_KEY(projectId));
    if (!old) return; // nothing cached yet — the refetch after this write is the source of truth
    const next = recount(old, edit(old.items));
    qc.setQueryData<ShoppingListResponse>(SHOPPING_KEY(projectId), next);
    qc.setQueryData<ShoppingListSummaryResponse[]>(SHOPPING_SUMMARY_KEY, (card) => card
      ?.map((s) => (s.projectId === projectId
        ? { ...s, totalCount: next.totalCount, boughtCount: next.boughtCount }
        : s))
      .filter((s) => s.totalCount > s.boughtCount));
  };

  return {
    add: useMutation({
      networkMode: 'always',
      mutationFn: (req: ShoppingListItemRequest) => {
        const id = newUuid();
        return offlineMutate<void>({
          entity: 'shoppingItem', entityId: id, type: 'create', payload: { projectId, req },
          deps: [projectId],
          online: async () => { await shoppingApi.add(projectId, req, id); },
          onOnlineSuccess: invalidate,
          optimistic: () => patch((items) => [...items, {
            id, materialId: req.materialId ?? null, name: req.name, unit: req.unit,
            quantity: req.quantity, bought: false, boughtAt: null, edited: false,
            suggestedQuantity: null, topUp: false,
            source: 'MANUAL', sourceEstimateId: null, note: req.note ?? null,
            sortOrder: items.length,
          }]),
        });
      },
    }),
    update: useMutation({
      networkMode: 'always',
      mutationFn: (vars: { itemId: string; req: ShoppingListItemUpdateRequest }) =>
        offlineMutate<void>({
          entity: 'shoppingItem', entityId: vars.itemId, type: 'update',
          payload: { projectId, req: vars.req }, deps: [projectId],
          online: async () => { await shoppingApi.update(projectId, vars.itemId, vars.req); },
          onOnlineSuccess: invalidate,
          optimistic: () => patch((items) => items.map((i) => (i.id === vars.itemId
            ? {
                ...i,
                // «Взяти нове» is the parked figure applied locally — the server does the same sum
                // from the row it holds, so an offline tap and its replay cannot disagree.
                quantity: vars.req.suggestion === 'ACCEPT' && i.suggestedQuantity != null
                  ? i.suggestedQuantity
                  : vars.req.quantity ?? i.quantity,
                // A hand-typed quantity is what stops the next recalculation overwriting it —
                // mirror the server so the offline row does not flip back on the next sync.
                // Taking our figure hands the row back to the calculator, so the flag drops.
                edited: vars.req.suggestion === 'ACCEPT' ? false
                  : vars.req.quantity != null ? true : i.edited,
                // Answered either way, the offer is gone; so is a stale one under a new number.
                suggestedQuantity: vars.req.suggestion != null || vars.req.quantity != null
                  ? null
                  : i.suggestedQuantity,
                note: vars.req.note ?? i.note,
                bought: vars.req.bought ?? i.bought,
                boughtAt: vars.req.bought === true ? new Date().toISOString()
                  : vars.req.bought === false ? null : i.boughtAt,
              }
            : i))),
        }),
    }),
    remove: useMutation({
      networkMode: 'always',
      mutationFn: (itemId: string) =>
        offlineMutate<void>({
          entity: 'shoppingItem', entityId: itemId, type: 'delete', payload: { projectId },
          deps: [projectId],
          online: async () => { await shoppingApi.remove(projectId, itemId); },
          onOnlineSuccess: invalidate,
          optimistic: () => patch((items) => items.filter((i) => i.id !== itemId)),
        }),
    }),
    clearBought: useMutation({
      networkMode: 'always',
      mutationFn: () =>
        // Its own entity, keyed on the OBJECT: the op is about the whole list rather than any one
        // row, and coalescing keeps two offline taps from queueing twice. It hides, never deletes.
        offlineMutate<void>({
          entity: 'shoppingClear', entityId: projectId, type: 'update', payload: { projectId },
          coalesce: true,
          online: async () => { await shoppingApi.clearBought(projectId); },
          onOnlineSuccess: invalidate,
          optimistic: () => patch((items) => items.filter((i) => !i.bought)),
        }),
    }),
  };
}
