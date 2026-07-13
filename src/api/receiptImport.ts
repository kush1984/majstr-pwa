import { api } from './client.ts';
import type {
  EstimateImportParseResponse,
  EstimateResponse,
  ReceiptItemsCommitItem,
} from './types.ts';

/**
 * Add line items to an open estimate from a receipt photo (store / terminal /
 * hand-written) via LLM vision (PRO-gated — `Feature.RECEIPT_IMPORT`). `parse`
 * returns a review proposal (the image is parsed server-side and never stored);
 * `commit` appends the confirmed lines to the estimate. Unlike the estimate
 * import, receipts never touch the catalog.
 */
export const receiptImportApi = {
  /** Parse a receipt photo → review proposal (reuses the estimate-import shape). */
  parse(estimateId: string, file: File): Promise<EstimateImportParseResponse> {
    const form = new FormData();
    form.append('file', file);
    return api
      .post<EstimateImportParseResponse>(
        `/api/estimates/${estimateId}/receipt-items/parse`,
        form,
        // Undefined removes the JSON default so the browser sets the multipart boundary.
        { headers: { 'Content-Type': undefined } as unknown as Record<string, string> },
      )
      .then((r) => r.data);
  },

  /** Append the confirmed receipt lines to the estimate → updated estimate. */
  commit(estimateId: string, items: ReceiptItemsCommitItem[]): Promise<EstimateResponse> {
    return api
      .post<EstimateResponse>(`/api/estimates/${estimateId}/receipt-items/commit`, { items })
      .then((r) => r.data);
  },
};
