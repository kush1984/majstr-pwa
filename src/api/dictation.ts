import { api } from './client.ts';
import type {
  DictationCommitItem,
  DictationParseResponse,
  EstimateResponse,
} from './types.ts';

/**
 * Add positions to an open estimate from text the master typed — or dictated with his own
 * keyboard's microphone, which is why there is no audio here at all: the PHONE keyboard already
 * turns speech into text far better than we could, and it works offline in the OS. (Windows voice
 * typing has no Ukrainian, so a desktop tester types the text instead — the flow is identical.)
 *
 * `parse` returns a review proposal matched against the master's own catalog and writes nothing —
 * the text is discarded server-side. `commit` appends the confirmed lines. No PRO gate in this
 * cut; a per-account hourly counter bounds the model calls (429 `error.rate.dictation`).
 */
export const dictationApi = {
  /** Free text → positions matched against the master's catalog (no write). */
  parse(estimateId: string, text: string): Promise<DictationParseResponse> {
    return api
      .post<DictationParseResponse>(`/api/estimates/${estimateId}/dictation/parse`, { text })
      .then((r) => r.data);
  },

  /** Append the confirmed dictated lines to the estimate → updated estimate. */
  commit(estimateId: string, items: DictationCommitItem[]): Promise<EstimateResponse> {
    return api
      .post<EstimateResponse>(`/api/estimates/${estimateId}/dictation/commit`, { items })
      .then((r) => r.data);
  },

  /**
   * Teach «say X, mean THIS catalog row» for the current master. The next dictation matches this
   * spoken wording outright — no Dice pass, no tie to refuse. Overwrites any previous target for the
   * same wording; per-master.
   */
  saveSynonym(catalogItemId: string, spokenText: string): Promise<void> {
    return api
      .post<void>(`/api/dictation/synonyms`, { catalogItemId, spokenText })
      .then(() => undefined);
  },
};
