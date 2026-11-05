import { api } from './client.ts';
import type {
  PaymentReceiptEditRequest,
  PaymentReceiptRequest,
  PaymentReceiptResponse,
} from './types.ts';

/**
 * Money the client paid on an object — FREE + PRO. Owner-scoped; the list also rides along inside
 * `economyApi.economy()`'s response (`payments.receipts`), so mutations here just invalidate that
 * query rather than maintaining a second cache. The payment plan (stages, split, surplus transfer)
 * is gone on both sides.
 */
export const paymentsApi = {
  /** Answers a one-element list — the shape from when a plan overflow wrote two rows. */
  addReceipt(objectId: string, req: PaymentReceiptRequest, id?: string): Promise<PaymentReceiptResponse[]> {
    return api
      .post<PaymentReceiptResponse[]>(`/api/projects/${objectId}/payments/receipts`, req,
        id ? { headers: { 'X-Entity-Uuid': id } } : undefined)
      .then((r) => r.data);
  },

  editReceipt(objectId: string, receiptId: string, req: PaymentReceiptEditRequest): Promise<PaymentReceiptResponse> {
    return api
      .patch<PaymentReceiptResponse>(`/api/projects/${objectId}/payments/receipts/${receiptId}`, req)
      .then((r) => r.data);
  },

  removeReceipt(objectId: string, receiptId: string): Promise<void> {
    return api.delete(`/api/projects/${objectId}/payments/receipts/${receiptId}`).then(() => undefined);
  },
};
