import { api } from './client.ts';
import type {
  PaymentReceiptEditRequest,
  PaymentReceiptRequest,
  PaymentReceiptResponse,
  PaymentSplitPreviewResponse,
  PaymentSplitRequest,
  PaymentSurplusTransferRequest,
  ProjectPaymentRequest,
  ProjectPaymentResponse,
} from './types.ts';

/**
 * Object-level payments (завдаток + графік виплат) — FREE + PRO, unlike the internal economy
 * (expenses/profit). Owner-scoped; the list also rides along inside `economyApi.economy()`'s
 * response (`payments.payments`), so mutations here just invalidate that query rather than
 * maintaining a second cache.
 */
export const paymentsApi = {
  add(objectId: string, req: ProjectPaymentRequest, id?: string): Promise<ProjectPaymentResponse> {
    return api
      .post<ProjectPaymentResponse>(`/api/projects/${objectId}/payments`, req,
        id ? { headers: { 'X-Entity-Uuid': id } } : undefined)
      .then((r) => r.data);
  },

  update(objectId: string, paymentId: string, req: ProjectPaymentRequest): Promise<ProjectPaymentResponse> {
    return api
      .patch<ProjectPaymentResponse>(`/api/projects/${objectId}/payments/${paymentId}`, req)
      .then((r) => r.data);
  },

  remove(objectId: string, paymentId: string): Promise<void> {
    return api.delete(`/api/projects/${objectId}/payments/${paymentId}`).then(() => undefined);
  },

  previewSplit(objectId: string, req: PaymentSplitRequest): Promise<PaymentSplitPreviewResponse> {
    return api
      .post<PaymentSplitPreviewResponse>(`/api/projects/${objectId}/payments/split/preview`, req)
      .then((r) => r.data);
  },

  commitSplit(objectId: string, req: PaymentSplitRequest): Promise<ProjectPaymentResponse[]> {
    return api
      .post<ProjectPaymentResponse[]>(`/api/projects/${objectId}/payments/split/commit`, req)
      .then((r) => r.data);
  },

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

  transferSurplus(objectId: string, req: PaymentSurplusTransferRequest): Promise<ProjectPaymentResponse[]> {
    return api
      .post<ProjectPaymentResponse[]>(`/api/projects/${objectId}/payments/receipts/transfer-surplus`, req)
      .then((r) => r.data);
  },
};
