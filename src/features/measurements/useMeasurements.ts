import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { measurementsApi } from '@/api/measurements.ts';
import { newUuid } from '@/lib/uuid.ts';
import { offlineMutate } from '@/lib/outbox/offlineMutation.ts';
import { computeMeasurementResult, recomputeTree, unitForType } from '@/lib/measurementCalc.ts';
import type {
  MeasurementItem,
  MeasurementItemRequest,
  MeasurementRoomRequest,
  MeasurementsResponse,
} from '@/api/types.ts';

export const MEASUREMENTS_KEY = (objectId: string) => ['measurements', objectId] as const;

const EMPTY: MeasurementsResponse = { rooms: [], areaTotal: 0, linearTotal: 0, pieceTotal: 0 };

/** The object's measurement tree. Runs only when enabled (PRO + on the Заміри tab). */
export function useMeasurements(objectId: string, enabled: boolean) {
  return useQuery({
    queryKey: MEASUREMENTS_KEY(objectId),
    queryFn: () => measurementsApi.tree(objectId),
    enabled: enabled && Boolean(objectId),
  });
}

/**
 * Mutations for rooms/elements — offline-first. Online they hit the backend, which returns the
 * fresh tree we prime the cache with (no refetch). OFFLINE they edit the cached tree optimistically
 * and queue the write: the element's `result` and the room/object totals are recomputed locally by
 * `measurementCalc` (a mirror of the server's `MeasurementCalc`), so a master measuring in a
 * basement sees correct numbers immediately; the server recomputes authoritatively on sync.
 *
 * Every mutation still RETURNS the tree, so existing callers (the electrical/sketch sheets, which
 * read the new room's id off it) work unchanged whether online or offline.
 */
export function useMeasurementActions(objectId: string) {
  const qc = useQueryClient();
  const key = MEASUREMENTS_KEY(objectId);
  const apply = (tree: MeasurementsResponse) => {
    qc.setQueryData(key, tree);
    return tree;
  };
  const current = (): MeasurementsResponse => qc.getQueryData<MeasurementsResponse>(key) ?? EMPTY;
  /** Optimistic tree edit + totals re-derived exactly like the server buckets them. */
  const edit = (fn: (t: MeasurementsResponse) => MeasurementsResponse): MeasurementsResponse =>
    apply(recomputeTree(fn(current())));

  const addRoom = useMutation({
    networkMode: 'always',
    mutationFn: (req: MeasurementRoomRequest): Promise<MeasurementsResponse> => {
      const id = newUuid();
      return offlineMutate<MeasurementsResponse>({
        entity: 'measurementRoom', entityId: id, type: 'create',
        payload: { objectId, req }, deps: [objectId],
        online: async () => apply(await measurementsApi.addRoom(objectId, req, id)),
        optimistic: () => edit((t) => ({
          ...t,
          rooms: [...t.rooms, {
            id, name: req.name, floor: req.floor ?? null,
            sortOrder: req.sortOrder ?? t.rooms.length,
            items: [], areaTotal: 0, linearTotal: 0, pieceTotal: 0,
          }],
        })),
      });
    },
  });

  const updateRoom = useMutation({
    networkMode: 'always',
    mutationFn: ({ roomId, req }: { roomId: string; req: MeasurementRoomRequest }): Promise<MeasurementsResponse> =>
      offlineMutate<MeasurementsResponse>({
        entity: 'measurementRoom', entityId: roomId, type: 'update',
        payload: { objectId, req }, deps: [objectId],
        online: async () => apply(await measurementsApi.updateRoom(objectId, roomId, req)),
        optimistic: () => edit((t) => ({
          ...t,
          rooms: t.rooms.map((r) => (r.id === roomId ? { ...r, name: req.name } : r)),
        })),
      }),
  });

  const deleteRoom = useMutation({
    networkMode: 'always',
    mutationFn: (roomId: string): Promise<MeasurementsResponse> =>
      offlineMutate<MeasurementsResponse>({
        entity: 'measurementRoom', entityId: roomId, type: 'delete',
        payload: { objectId }, deps: [objectId],
        online: async () => apply(await measurementsApi.deleteRoom(objectId, roomId)),
        optimistic: () => edit((t) => ({ ...t, rooms: t.rooms.filter((r) => r.id !== roomId) })),
      }),
  });

  const addItem = useMutation({
    networkMode: 'always',
    mutationFn: ({ roomId, req }: { roomId: string; req: MeasurementItemRequest }): Promise<MeasurementsResponse> => {
      const id = newUuid();
      return offlineMutate<MeasurementsResponse>({
        entity: 'measurementItem', entityId: id, type: 'create',
        payload: { objectId, roomId, req }, deps: [roomId],
        online: async () => apply(await measurementsApi.addItem(objectId, roomId, req, id)),
        optimistic: () => edit((t) => ({
          ...t,
          rooms: t.rooms.map((r) => (r.id === roomId ? { ...r, items: [...r.items, itemOf(id, req, r.items.length)] } : r)),
        })),
      });
    },
  });

  const updateItem = useMutation({
    networkMode: 'always',
    mutationFn: (
      { roomId, itemId, req }: { roomId: string; itemId: string; req: MeasurementItemRequest },
    ): Promise<MeasurementsResponse> =>
      offlineMutate<MeasurementsResponse>({
        entity: 'measurementItem', entityId: itemId, type: 'update',
        payload: { objectId, roomId, req }, deps: [roomId],
        online: async () => apply(await measurementsApi.updateItem(objectId, roomId, itemId, req)),
        optimistic: () => edit((t) => ({
          ...t,
          rooms: t.rooms.map((r) => (r.id !== roomId ? r : {
            ...r,
            items: r.items.map((i) => (i.id === itemId ? itemOf(itemId, req, i.sortOrder) : i)),
          })),
        })),
      }),
  });

  const deleteItem = useMutation({
    networkMode: 'always',
    mutationFn: ({ roomId, itemId }: { roomId: string; itemId: string }): Promise<MeasurementsResponse> =>
      offlineMutate<MeasurementsResponse>({
        entity: 'measurementItem', entityId: itemId, type: 'delete',
        payload: { objectId, roomId }, deps: [roomId],
        online: async () => apply(await measurementsApi.deleteItem(objectId, roomId, itemId)),
        optimistic: () => edit((t) => ({
          ...t,
          rooms: t.rooms.map((r) => (r.id !== roomId ? r : { ...r, items: r.items.filter((i) => i.id !== itemId) })),
        })),
      }),
  });

  return { addRoom, updateRoom, deleteRoom, addItem, updateItem, deleteItem };
}

/** Build the optimistic element — its unit and result computed exactly as the server would. */
function itemOf(id: string, req: MeasurementItemRequest, sortOrder: number): MeasurementItem {
  return {
    id,
    name: req.name,
    type: req.type,
    unit: unitForType(req.type),
    result: computeMeasurementResult(req.type, req.payload),
    payload: req.payload,
    sortOrder: req.sortOrder ?? sortOrder,
  };
}
