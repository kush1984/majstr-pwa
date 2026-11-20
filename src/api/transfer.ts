import { api, LLM_TIMEOUT_MS } from './client.ts';
import { sendOnce } from './submission.ts';
import type {
  TransferCommitRequest, TransferCommitResponse, TransferMapping, TransferParseResponse,
} from './types.ts';

/**
 * «Перенести в Majstr». `parseFile` reads ONE file (PDF, Excel, CSV or a photo) — the page sends
 * them one by one so a pile shows progress and one bad file costs only itself; nothing is written.
 * `commit` writes the confirmed review in one transaction.
 */
export const transferApi = {
  /** `mapping` = the columns the master re-picked on a table the server read without AI. */
  parseFile(file: File, mapping?: TransferMapping): Promise<TransferParseResponse> {
    const form = new FormData();
    form.append('file', file);
    if (mapping) {
      for (const [key, col] of Object.entries(mapping)) {
        if (col != null) form.append(key, String(col));
      }
    }
    return api
      .post<TransferParseResponse>('/api/transfer/parse', form, {
        headers: { 'Content-Type': undefined } as unknown as Record<string, string>,
      })
      .then((r) => r.data);
  },

  commit(req: TransferCommitRequest): Promise<TransferCommitResponse> {
    return sendOnce(`transfer:${JSON.stringify(req)}`, (headers) =>
      api
        // A whole history of objects in one transaction — longer than an ordinary commit.
        .post<TransferCommitResponse>('/api/transfer/commit', req, { headers, timeout: LLM_TIMEOUT_MS })
        .then((r) => r.data),
    );
  },
};
