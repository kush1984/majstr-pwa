import { api } from './client.ts';
import type {
  MeasurementItemRequest,
  MeasurementRoomRequest,
  MeasurementsResponse,
} from './types.ts';

/**
 * Object measurements (Заміри) — per-object rooms + measured elements (PRO). Every
 * mutating call returns the fresh tree (rooms → elements + per-room/object totals), so
 * one round-trip updates everything. Owner-only; never reaches the client portal/PDF.
 */
const base = (objectId: string) => `/api/projects/${objectId}/measurements`;

export const measurementsApi = {
  tree(objectId: string): Promise<MeasurementsResponse> {
    return api.get<MeasurementsResponse>(base(objectId)).then((r) => r.data);
  },

  /** `id` (a client-generated UUID) rides the X-Entity-Uuid header → idempotent offline replay. */
  addRoom(objectId: string, req: MeasurementRoomRequest, id?: string): Promise<MeasurementsResponse> {
    return api
      .post<MeasurementsResponse>(`${base(objectId)}/rooms`, req,
        id ? { headers: { 'X-Entity-Uuid': id } } : undefined)
      .then((r) => r.data);
  },
  updateRoom(objectId: string, roomId: string, req: MeasurementRoomRequest): Promise<MeasurementsResponse> {
    return api.patch<MeasurementsResponse>(`${base(objectId)}/rooms/${roomId}`, req).then((r) => r.data);
  },
  deleteRoom(objectId: string, roomId: string): Promise<MeasurementsResponse> {
    return api.delete<MeasurementsResponse>(`${base(objectId)}/rooms/${roomId}`).then((r) => r.data);
  },

  addItem(
    objectId: string,
    roomId: string,
    req: MeasurementItemRequest,
    id?: string,
  ): Promise<MeasurementsResponse> {
    return api
      .post<MeasurementsResponse>(`${base(objectId)}/rooms/${roomId}/items`, req,
        id ? { headers: { 'X-Entity-Uuid': id } } : undefined)
      .then((r) => r.data);
  },
  updateItem(
    objectId: string,
    roomId: string,
    itemId: string,
    req: MeasurementItemRequest,
  ): Promise<MeasurementsResponse> {
    return api
      .patch<MeasurementsResponse>(`${base(objectId)}/rooms/${roomId}/items/${itemId}`, req)
      .then((r) => r.data);
  },
  deleteItem(objectId: string, roomId: string, itemId: string): Promise<MeasurementsResponse> {
    return api
      .delete<MeasurementsResponse>(`${base(objectId)}/rooms/${roomId}/items/${itemId}`)
      .then((r) => r.data);
  },
};
