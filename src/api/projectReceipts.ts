import { api } from './client.ts';
import type {
  ProjectReceiptRequest,
  ProjectReceiptResponse,
  ProjectReceiptsResponse,
  ReceiptRecognizeResponse,
} from './types.ts';

/**
 * «Чеки обʼєкта» (V129) — the paper the master photographs at the till, filed against the OBJECT.
 *
 * <p>The act's receipts (see {@link actsApi}) are a separate table on purpose: those are frozen
 * into a signed act's doc_hash, while these are filed long before any act exists. The endpoints
 * otherwise mirror them one for one, so the two clients read the same.</p>
 *
 * <p>A receipt here is a RECEIVABLE by default — the client owes the money back — and only an
 * explicit «це моя витрата» turns it into an object expense. That flag lives on the PATCH.</p>
 */
const base = (projectId: string) => `/api/projects/${projectId}/receipts`;

export const projectReceiptsApi = {
  list(projectId: string): Promise<ProjectReceiptsResponse> {
    return api.get<ProjectReceiptsResponse>(base(projectId)).then((r) => r.data);
  },

  /**
   * Attach a receipt: a MANDATORY photo of the paper, plus an amount and a label that may both
   * still be unknown. Multipart, so the JSON Content-Type is unset for the browser to write its
   * own boundary (same as photosApi and the act's receipts).
   *
   * <p>The photo is saved FIRST and priced afterwards (receipts-batch): amount 0 is a legal saved
   * state here, and unlike the act's receipts nothing gates on it — an object has no signature to
   * block. A blank label is named «Чек №N» by the SERVER, the only side that knows how many
   * receipts this object already holds.</p>
   *
   * <p>`id` is a client-generated UUID riding X-Entity-Uuid: a batch upload over a weak connection
   * is exactly where a retry happens, and a duplicated receipt is duplicated money the client is
   * asked to pay back twice.</p>
   */
  add(
    projectId: string,
    req: { id?: string; label?: string; amount: number; issuedAt?: string | null; file: File },
  ): Promise<ProjectReceiptResponse> {
    const form = new FormData();
    form.append('file', req.file); // mandatory: the photo is the receipt's proof
    if (req.label != null && req.label.trim() !== '') form.append('label', req.label);
    form.append('amount', String(req.amount));
    if (req.issuedAt) form.append('issuedAt', req.issuedAt);
    return api
      .post<ProjectReceiptResponse>(base(projectId), form, {
        headers: {
          'Content-Type': undefined,
          ...(req.id ? { 'X-Entity-Uuid': req.id } : {}),
        } as unknown as Record<string, string>,
      })
      .then((r) => r.data);
  },

  /**
   * Read the receipt from its printed fiscal QR — free, no model call, and it is the only rung
   * that returns the paper's fiscal identity, which is what lets a later duplicate be flagged.
   */
  readQr(projectId: string, payload: string): Promise<ReceiptRecognizeResponse> {
    return api
      .post<ReceiptRecognizeResponse>(`${base(projectId)}/qr`, { payload })
      .then((r) => r.data);
  },

  /**
   * Recognize a receipt that is ALREADY stored — reads the photo the upload already sent, so a
   * slow read never re-uploads and survives a page reload. Persists nothing: the answer prefills
   * the form and the master confirms it with a PATCH.
   */
  recognizeStored(projectId: string, receiptId: string): Promise<ReceiptRecognizeResponse> {
    return api
      .post<ReceiptRecognizeResponse>(`${base(projectId)}/${receiptId}/recognize`, null)
      .then((r) => r.data);
  },

  update(
    projectId: string,
    receiptId: string,
    req: ProjectReceiptRequest,
  ): Promise<ProjectReceiptResponse> {
    return api
      .patch<ProjectReceiptResponse>(`${base(projectId)}/${receiptId}`, req)
      .then((r) => r.data);
  },

  remove(projectId: string, receiptId: string): Promise<void> {
    return api.delete(`${base(projectId)}/${receiptId}`).then(() => undefined);
  },

  /** Path of a receipt photo — fed to photosApi, which carries the bearer token. */
  fileUrl(projectId: string, receiptId: string): string {
    return `${base(projectId)}/${receiptId}/file`;
  },
};
