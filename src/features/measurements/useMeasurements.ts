import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { measurementsApi } from '@/api/measurements.ts';
import type {
  MeasurementItemRequest,
  MeasurementRoomRequest,
  MeasurementsResponse,
} from '@/api/types.ts';

export const MEASUREMENTS_KEY = (objectId: string) => ['measurements', objectId] as const;

/** The object's measurement tree. Runs only when enabled (PRO + on the Заміри tab). */
export function useMeasurements(objectId: string, enabled: boolean) {
  return useQuery({
    queryKey: MEASUREMENTS_KEY(objectId),
    queryFn: () => measurementsApi.tree(objectId),
    enabled: enabled && Boolean(objectId),
  });
}

/**
 * Mutations for rooms/elements. Each backend call returns the fresh tree, so we prime the
 * query cache with it directly (no refetch). One place to keep the invalidation consistent.
 */
export function useMeasurementActions(objectId: string) {
  const qc = useQueryClient();
  const apply = (tree: MeasurementsResponse) => qc.setQueryData(MEASUREMENTS_KEY(objectId), tree);

  const addRoom = useMutation({
    mutationFn: (req: MeasurementRoomRequest) => measurementsApi.addRoom(objectId, req),
    onSuccess: apply,
  });
  const updateRoom = useMutation({
    mutationFn: (v: { roomId: string; req: MeasurementRoomRequest }) =>
      measurementsApi.updateRoom(objectId, v.roomId, v.req),
    onSuccess: apply,
  });
  const deleteRoom = useMutation({
    mutationFn: (roomId: string) => measurementsApi.deleteRoom(objectId, roomId),
    onSuccess: apply,
  });
  const addItem = useMutation({
    mutationFn: (v: { roomId: string; req: MeasurementItemRequest }) =>
      measurementsApi.addItem(objectId, v.roomId, v.req),
    onSuccess: apply,
  });
  const updateItem = useMutation({
    mutationFn: (v: { roomId: string; itemId: string; req: MeasurementItemRequest }) =>
      measurementsApi.updateItem(objectId, v.roomId, v.itemId, v.req),
    onSuccess: apply,
  });
  const deleteItem = useMutation({
    mutationFn: (v: { roomId: string; itemId: string }) =>
      measurementsApi.deleteItem(objectId, v.roomId, v.itemId),
    onSuccess: apply,
  });

  return { addRoom, updateRoom, deleteRoom, addItem, updateItem, deleteItem };
}
