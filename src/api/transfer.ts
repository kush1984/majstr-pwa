import { api, LLM_TIMEOUT_MS } from './client.ts';
import { sendOnce } from './submission.ts';
import type { TransferCommitRequest, TransferCommitResponse, TransferParseResponse } from './types.ts';

/**
 * «Перенести в Majstr». `parseFile` reads ONE file (PDF, Excel, CSV or a photo) — the page sends
 * them one by one so a pile shows progress and one bad file costs only itself; nothing is written.
 * `commit` writes the confirmed review in one transaction.
 */
export const transferApi = {
  parseFile(file: File): Promise<TransferParseResponse> {
    const form = new FormData();
    form.append('file', file);
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
