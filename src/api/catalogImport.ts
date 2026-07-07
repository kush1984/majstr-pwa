import { api } from './client.ts';
import type {
  CatalogImportCommitRequest,
  CatalogImportCommitResponse,
  CatalogImportParseResponse,
} from './types.ts';

/**
 * "Import my price list" into the catalog. `parse*` returns a review proposal
 * (nothing is written); `commit` persists the master-confirmed list with dedup.
 * The uploaded file is parsed server-side in memory and never stored.
 */
export const catalogImportApi = {
  /** Parse an uploaded .xlsx/.xls/.csv file. */
  parseFile(file: File): Promise<CatalogImportParseResponse> {
    const form = new FormData();
    form.append('file', file);
    return api
      .post<CatalogImportParseResponse>('/api/catalog/import/parse', form, {
        // Undefined removes the JSON default so the browser sets the multipart
        // boundary (same trick as the logo upload).
        headers: { 'Content-Type': undefined } as unknown as Record<string, string>,
      })
      .then((r) => r.data);
  },

  /** Parse pasted tab-separated rows (as copied from Excel/Google Sheets). */
  parseText(text: string): Promise<CatalogImportParseResponse> {
    return api
      .post<CatalogImportParseResponse>('/api/catalog/import/parse', text, {
        headers: { 'Content-Type': 'text/plain' },
      })
      .then((r) => r.data);
  },

  commit(req: CatalogImportCommitRequest): Promise<CatalogImportCommitResponse> {
    return api.post<CatalogImportCommitResponse>('/api/catalog/import/commit', req).then((r) => r.data);
  },
};
