import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { shoppingApi } from '@/api/shopping.ts';
import { toAppError } from '@/api/errors.ts';
import { toast } from '@/hooks/useToast.ts';
import { newUuid } from '@/lib/uuid.ts';
import { offlineMutate } from '@/lib/outbox/offlineMutation.ts';
import { dropPendingCreate, patchPendingCreate } from '@/lib/outbox/outbox.ts';
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

/** The outbox entity every row write queues under — same spelling as the handler in `outbox/init.ts`. */
const ITEM_ENTITY = 'shoppingItem';

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
 * The home card after a write — in BOTH directions.
 *
 * <p>Patching by `map` alone could only ever SHRINK the card: it edited the rows the card already
 * had and dropped the settled ones. So un-ticking the last row of a finished list, or putting the
 * first row into a list the card had never carried, left «🛒 Купити» quietly missing an object the
 * master was looking at that very moment — until some later fetch happened to correct it.</p>
 *
 * <p>Position is kept where the object already had one: the card's order is the server's, and a row
 * that jumped to the bottom every time it was touched reads as a different object.</p>
 */
function cardWith(
  card: ShoppingListSummaryResponse[],
  list: ShoppingListResponse,
): ShoppingListSummaryResponse[] {
  const mine: ShoppingListSummaryResponse = {
    projectId: list.projectId,
    projectName: list.projectName,
    totalCount: list.totalCount,
    boughtCount: list.boughtCount,
  };
  const patched = card.some((s) => s.projectId === mine.projectId)
    ? card.map((s) => (s.projectId === mine.projectId ? mine : s))
    : [...card, mine];
  // Nothing left to buy = nothing to show, exactly as the server's own summary omits such a list.
  return patched.filter((s) => s.totalCount > s.boughtCount);
}

/**
 * Fold an edit into the row's own queued create, when it still has one.
 *
 * <p>A row added and then corrected in the same basement has no server row to PATCH — its create is
 * still in the outbox. Stacked behind it, the PATCH is a second round trip to say what the create
 * could have said in the first place. Act receipts fold for the same reason
 * ({@link patchPendingCreate}).</p>
 *
 * <p>Only `quantity` and `note` fold, because only those are fields of the CREATE request. A tick
 * and the answer to a recalculation offer keep the ordinary op — which is SAFE here, unlike an act
 * receipt: the create replays under the row's own id as `X-Entity-Uuid`, so the server row it makes
 * is precisely the one the PATCH behind it addresses. (Neither reaches a queued create in practice:
 * the tick is on a row he just typed, and an offer is parked by a server-side recalculation.)</p>
 *
 * <p>False = there is no queued create — the ordinary case, and also «it drained a moment ago».</p>
 */
async function foldIntoPendingCreate(
  itemId: string,
  req: ShoppingListItemUpdateRequest,
): Promise<boolean> {
  if (req.bought !== undefined || req.suggestion !== undefined) return false;
  if (req.quantity === undefined && req.note === undefined) return false;
  return patchPendingCreate(ITEM_ENTITY, itemId, (raw) => {
    const payload = raw as { projectId: string; req: ShoppingListItemRequest };
    return {
      ...payload,
      req: {
        ...payload.req,
        quantity: req.quantity ?? payload.req.quantity,
        // `''` is a note he deliberately cleared, so `??` and not `||`.
        note: req.note ?? payload.req.note,
      },
    };
  });
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

  /**
   * Patch the cached list AND the home card, and hand back the undo.
   *
   * <p>The undo is what lets the same patch run ONLINE. An optimistic tick a refused write leaves
   * standing is worse than no tick at all: the row then lies until something refetches it, and in a
   * shop the master is reading the row, not the toast.</p>
   */
  const patch = (edit: (items: ShoppingListItemResponse[]) => ShoppingListItemResponse[]) => {
    const oldList = qc.getQueryData<ShoppingListResponse>(SHOPPING_KEY(projectId));
    // Nothing cached yet — the refetch after this write is the source of truth, so nothing to undo.
    if (!oldList) return () => undefined;
    const oldCard = qc.getQueryData<ShoppingListSummaryResponse[]>(SHOPPING_SUMMARY_KEY);

    const next = recount(oldList, edit(oldList.items));
    qc.setQueryData<ShoppingListResponse>(SHOPPING_KEY(projectId), next);
    if (oldCard) {
      qc.setQueryData<ShoppingListSummaryResponse[]>(SHOPPING_SUMMARY_KEY, cardWith(oldCard, next));
    }

    return () => {
      qc.setQueryData<ShoppingListResponse>(SHOPPING_KEY(projectId), oldList);
      if (oldCard) qc.setQueryData<ShoppingListSummaryResponse[]>(SHOPPING_SUMMARY_KEY, oldCard);
    };
  };

  /**
   * Every write on this screen: move the row first, put it back if the server refuses.
   *
   * <p>The patch used to be handed to {@link offlineMutate} as its `optimistic` callback, which runs
   * ONLY on the queued path — so with a signal the screen sat still until the refetch landed, and
   * the master tapped the tick again. A NETWORK blip is not a refusal: `offlineMutate` queues it,
   * the write resolves, and the patch rightly stands.</p>
   */
  const optimistically = async (
    edit: (items: ShoppingListItemResponse[]) => ShoppingListItemResponse[],
    write: () => Promise<void>,
  ) => {
    const undo = patch(edit);
    try {
      await write();
    } catch (e) {
      undo();
      throw e;
    }
  };

  /**
   * Say so when a write is refused.
   *
   * <p>Silence was the bug: every one of these mutations swallowed a 4xx, so a row the server would
   * not take looked saved — and the master walked out of the shop without the material.</p>
   */
  const onError = (err: unknown) => {
    toast.error(toAppError(err).message);
  };

  /** One row's write, shared by an explicit edit and by the tick. */
  const writeUpdate = (itemId: string, req: ShoppingListItemUpdateRequest) =>
    optimistically(
      (items) => items.map((i) => (i.id === itemId
        ? {
            ...i,
            // «Взяти нове» is the parked figure applied locally — the server does the same sum
            // from the row it holds, so an offline tap and its replay cannot disagree.
            quantity: req.suggestion === 'ACCEPT' && i.suggestedQuantity != null
              ? i.suggestedQuantity
              : req.quantity ?? i.quantity,
            // A hand-typed quantity is what stops the next recalculation overwriting it —
            // mirror the server so the offline row does not flip back on the next sync.
            // Taking our figure hands the row back to the calculator, so the flag drops.
            edited: req.suggestion === 'ACCEPT' ? false
              : req.quantity != null ? true : i.edited,
            // Answered either way, the offer is gone; so is a stale one under a new number.
            suggestedQuantity: req.suggestion != null || req.quantity != null
              ? null
              : i.suggestedQuantity,
            note: req.note ?? i.note,
            bought: req.bought ?? i.bought,
            boughtAt: req.bought === true ? new Date().toISOString()
              : req.bought === false ? null : i.boughtAt,
          }
        : i)),
      async () => {
        if (await foldIntoPendingCreate(itemId, req)) return;
        await offlineMutate<void>({
          entity: ITEM_ENTITY, entityId: itemId, type: 'update',
          payload: { projectId, req }, deps: [projectId],
          online: async () => { await shoppingApi.update(projectId, itemId, req); },
          onOnlineSuccess: invalidate,
          optimistic: () => undefined, // the cache is patched above, on BOTH paths
        });
      },
    );

  return {
    add: useMutation({
      networkMode: 'always',
      onError,
      mutationFn: (req: ShoppingListItemRequest) => {
        const id = newUuid();
        return optimistically(
          (items) => [...items, {
            id, materialId: req.materialId ?? null, name: req.name, unit: req.unit,
            quantity: req.quantity, bought: false, boughtAt: null, edited: false,
            suggestedQuantity: null, topUp: false,
            source: 'MANUAL', sourceEstimateId: null, note: req.note ?? null,
            sortOrder: items.length,
          }],
          () => offlineMutate<void>({
            entity: ITEM_ENTITY, entityId: id, type: 'create', payload: { projectId, req },
            deps: [projectId],
            online: async () => { await shoppingApi.add(projectId, req, id); },
            onOnlineSuccess: invalidate,
            optimistic: () => undefined,
          }),
        );
      },
    }),
    update: useMutation({
      networkMode: 'always',
      onError,
      mutationFn: (vars: { itemId: string; req: ShoppingListItemUpdateRequest }) =>
        writeUpdate(vars.itemId, vars.req),
    }),
    /**
     * Tick or untick — deciding WHICH WAY from the row in the cache, not from the one the screen
     * happened to be rendering.
     *
     * <p>The page sent `!item.bought` off its render closure. On a list that moved underneath it —
     * a sync landing, another tab, a second tap on a laggy screen — that says «make it bought»
     * about a row that already is, and the write lands as an undo of whatever changed it.</p>
     */
    toggle: useMutation({
      networkMode: 'always',
      onError,
      mutationFn: async (itemId: string) => {
        const current = qc
          .getQueryData<ShoppingListResponse>(SHOPPING_KEY(projectId))
          ?.items.find((i) => i.id === itemId);
        if (!current) return; // the row went out from under him; there is nothing to flip
        await writeUpdate(itemId, { bought: !current.bought });
      },
    }),
    remove: useMutation({
      networkMode: 'always',
      onError,
      mutationFn: (itemId: string) =>
        optimistically(
          (items) => items.filter((i) => i.id !== itemId),
          async () => {
            // Added and deleted without ever reaching the server: dropping the queued create IS the
            // delete. As an op of its own it replayed POST-then-DELETE — two round trips to arrive
            // where the master already is, the first of them spending a row against his object.
            if (await dropPendingCreate(ITEM_ENTITY, itemId)) return;
            await offlineMutate<void>({
              entity: ITEM_ENTITY, entityId: itemId, type: 'delete', payload: { projectId },
              deps: [projectId],
              online: async () => { await shoppingApi.remove(projectId, itemId); },
              onOnlineSuccess: invalidate,
              optimistic: () => undefined,
            });
          },
        ),
    }),
    clearBought: useMutation({
      networkMode: 'always',
      onError,
      mutationFn: () =>
        optimistically(
          (items) => items.filter((i) => !i.bought),
          // Its own entity, keyed on the OBJECT: the op is about the whole list rather than any one
          // row, and coalescing keeps two offline taps from queueing twice. It hides, never deletes.
          () => offlineMutate<void>({
            entity: 'shoppingClear', entityId: projectId, type: 'update', payload: { projectId },
            coalesce: true,
            online: async () => { await shoppingApi.clearBought(projectId); },
            onOnlineSuccess: invalidate,
            optimistic: () => undefined,
          }),
        ),
    }),
  };
}
