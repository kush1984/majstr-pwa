import { api } from './client.ts';
import type {
  EstimateImportCommitRequest,
  EstimateImportCommitResponse,
  EstimateImportParseResponse,
} from './types.ts';

/**
 * Import a ready estimate onto an object from an Excel/CSV file or a photo
 * (printed or hand-written) via LLM extraction (PRO-gated). `parseFile` returns a
 * review proposal (nothing is written; the file is parsed server-side and never
 * stored); `commit` creates the estimate on the object and upserts the ticked
 * positions into the catalog.
 */
export const estimateImportApi = {
  /** Parse an uploaded Excel/CSV file or a photo → review proposal. */
  parseFile(file: File): Promise<EstimateImportParseResponse> {
    const form = new FormData();
    form.append('file', file);
    return api
      .post<EstimateImportParseResponse>('/api/estimates/import/parse', form, {
        // Undefined removes the JSON default so the browser sets the multipart
        // boundary (same trick as the logo + catalog-import uploads).
        headers: { 'Content-Type': undefined } as unknown as Record<string, string>,
      })
      .then((r) => r.data);
  },

  commit(req: EstimateImportCommitRequest): Promise<EstimateImportCommitResponse> {
    return api
      .post<EstimateImportCommitResponse>('/api/estimates/import/commit', req)
      .then((r) => r.data);
  },
};
