import { api, ensureAccessToken } from './client.ts';
import { config } from '@/lib/config.ts';
import type {
  ActReceiptRecognizeResponse,
  ActProgressResponse,
  WorkActCreateRequest,
  WorkActItemsRequest,
  WorkActReceiptRequest,
  WorkActReceiptResponse,
  WorkActResponse,
  WorkActSignOfflineRequest,
  WorkActStatus,
  WorkActUpdateRequest,
} from './types.ts';

/**
 * Work acts (Акти виконаних робіт). Money (total / payable) is computed by the backend and read
 * off the response — the client never sums it. line_total / cumulative_before on the items are
 * server-authored too; the client only sends quantities.
 */
export const actsApi = {
  list(projectId: string): Promise<WorkActResponse[]> {
    return api.get<WorkActResponse[]>(`/api/projects/${projectId}/acts`).then((r) => r.data);
  },

  progress(projectId: string): Promise<ActProgressResponse> {
    return api.get<ActProgressResponse>(`/api/projects/${projectId}/acts/progress`).then((r) => r.data);
  },

  /** `id` (a client UUID) rides X-Entity-Uuid → idempotent offline replay of the draft create. */
  create(projectId: string, req: WorkActCreateRequest, id?: string): Promise<WorkActResponse> {
    return api
      .post<WorkActResponse>(`/api/projects/${projectId}/acts`, req,
        id ? { headers: { 'X-Entity-Uuid': id } } : undefined)
      .then((r) => r.data);
  },

  get(id: string): Promise<WorkActResponse> {
    return api.get<WorkActResponse>(`/api/acts/${id}`).then((r) => r.data);
  },

  updateHeader(id: string, req: WorkActUpdateRequest): Promise<WorkActResponse> {
    return api.patch<WorkActResponse>(`/api/acts/${id}`, req).then((r) => r.data);
  },

  replaceItems(id: string, req: WorkActItemsRequest): Promise<WorkActResponse> {
    return api.put<WorkActResponse>(`/api/acts/${id}/items`, req).then((r) => r.data);
  },

  remove(id: string): Promise<void> {
    return api.delete(`/api/acts/${id}`).then(() => undefined);
  },

  signOffline(id: string, req: WorkActSignOfflineRequest): Promise<WorkActResponse> {
    return api.post<WorkActResponse>(`/api/acts/${id}/sign-offline`, req).then((r) => r.data);
  },

  /**
   * Attach a receipt: a MANDATORY photo of the paper, plus an amount and a label that may still be
   * unknown. Multipart, so the JSON Content-Type is unset for the browser to write its own boundary
   * (same as photosApi).
   *
   * <p>The photo is saved FIRST and priced afterwards (receipts-batch — «з недостатньою швидкістю
   * інтернету довго думає і додавати чек не хоче»): amount 0 is a legal, saved state that blocks
   * only sharing and signing. A blank label is named «Чек №N» by the SERVER, which is the only side
   * that knows how many receipts this act already holds.</p>
   *
   * <p>`id` is a client-generated UUID riding X-Entity-Uuid: a batch upload over a weak connection
   * is exactly where a retry happens, and a duplicated receipt is duplicated money — in the act and
   * in the ADDENDUM estimate its receipts roll into on signing.</p>
   */
  addReceipt(
    actId: string,
    req: { id?: string; label?: string; amount: number; issuedAt?: string | null; file: File;
           saveToPhotos?: boolean },
  ): Promise<WorkActReceiptResponse> {
    const form = new FormData();
    form.append('file', req.file); // mandatory (round 2): the photo is the receipt's proof
    if (req.label != null && req.label.trim() !== '') form.append('label', req.label);
    form.append('amount', String(req.amount));
    if (req.saveToPhotos) form.append('saveToPhotos', 'true');
    if (req.issuedAt) form.append('issuedAt', req.issuedAt);
    return api
      .post<WorkActReceiptResponse>(`/api/acts/${actId}/receipts`, form, {
        headers: {
          'Content-Type': undefined,
          ...(req.id ? { 'X-Entity-Uuid': req.id } : {}),
        } as unknown as Record<string, string>,
      })
      .then((r) => r.data);
  },

  /** Read the photo before adding: label + date + total off the footer (small model). A receipt is
   *  re-billed as a whole, so its item table is never read here. recognized=false is the soft
   *  «введіть вручну» outcome, not an error. */
  recognizeReceipt(actId: string, file: File): Promise<ActReceiptRecognizeResponse> {
    const form = new FormData();
    form.append('file', file);
    return api
      .post<ActReceiptRecognizeResponse>(`/api/acts/${actId}/receipts/recognize`, form,
        { headers: { 'Content-Type': undefined } })
      .then((r) => r.data);
  },

  /**
   * Recognize a receipt that is ALREADY stored — the «✨ Розпізнати» button on a receipt card.
   * Reads the photo the upload already sent, so a slow link is paid once, and the read survives a
   * page reload. Persists nothing: the answer prefills the edit dialog, the master confirms.
   */
  recognizeStoredReceipt(actId: string, receiptId: string): Promise<ActReceiptRecognizeResponse> {
    return api
      .post<ActReceiptRecognizeResponse>(
        `/api/acts/${actId}/receipts/${receiptId}/recognize`, null)
      .then((r) => r.data);
  },

  /**
   * Read the receipt from its printed fiscal QR code instead of its photo — same response shape as
   * recognizeReceipt, free, no model call and no tax-service lookup: label + date + total, read
   * locally, which is what makes it safe to fire on every photo of a batch.
   */
  readReceiptQr(actId: string, payload: string): Promise<ActReceiptRecognizeResponse> {
    return api
      .post<ActReceiptRecognizeResponse>(
        `/api/acts/${actId}/receipts/qr`, { payload })
      .then((r) => r.data);
  },

  updateReceipt(actId: string, receiptId: string, req: WorkActReceiptRequest): Promise<WorkActReceiptResponse> {
    return api
      .patch<WorkActReceiptResponse>(`/api/acts/${actId}/receipts/${receiptId}`, req)
      .then((r) => r.data);
  },

  removeReceipt(actId: string, receiptId: string): Promise<void> {
    return api.delete(`/api/acts/${actId}/receipts/${receiptId}`).then(() => undefined);
  },

  /** Path of a receipt photo — fed to photosApi.fetchBlobUrl, which carries the bearer token. */
  receiptFileUrl(actId: string, receiptId: string): string {
    return `/api/acts/${actId}/receipts/${receiptId}/file`;
  },

  /** Owner-side status move: SENT→DRAFT (recall), SENT→REJECTED (client declined), REJECTED→DRAFT. */
  changeStatus(id: string, status: WorkActStatus): Promise<WorkActResponse> {
    return api.patch<WorkActResponse>(`/api/acts/${id}/status`, { status }).then((r) => r.data);
  },

  /** Same blob pattern as the estimate PDF — a bearer fetch, not a plain <a href>. */
  async fetchPdf(id: string): Promise<{ url: string; revoke: () => void }> {
    const access = await ensureAccessToken();
    const resp = await fetch(`${config.apiBaseUrl}/api/acts/${id}/pdf`, {
      headers: { Authorization: `Bearer ${access ?? ''}` },
    });
    if (!resp.ok) {
      throw new Error(`PDF request failed: ${resp.status}`);
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    return { url, revoke: () => URL.revokeObjectURL(url) };
  },
};
