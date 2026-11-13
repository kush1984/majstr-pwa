import { api, ensureAccessToken, fetchTimeoutSignal } from './client.ts';
import { httpError } from './errors.ts';
import { config } from '@/lib/config.ts';
import type { ClientPreviewResponse, PriceListRequest, PriceListResponse } from './types.ts';

/** «Поділитися прайсом» (V205): the works the master ticks for a client, as a link and a PDF. */
export const priceListApi = {
  get(): Promise<PriceListResponse> {
    return api.get<PriceListResponse>('/api/price-list').then((r) => r.data);
  },

  /** Saves the whole set of ticks and makes sure a live link exists. */
  save(req: PriceListRequest): Promise<PriceListResponse> {
    return api.put<PriceListResponse>('/api/price-list', req).then((r) => r.data);
  },

  /** Saves the ticks and hands back a ten-minute preview of the client's page — no link is minted. */
  preview(req: PriceListRequest): Promise<ClientPreviewResponse> {
    return api.post<ClientPreviewResponse>('/api/price-list/preview', req).then((r) => r.data);
  },

  /** «Закрити посилання»: the client's page stops opening; the next share mints a new link. */
  revoke(): Promise<PriceListResponse> {
    return api.delete<PriceListResponse>('/api/price-list/link').then((r) => r.data);
  },

  async fetchPdfBlob(): Promise<Blob> {
    const access = await ensureAccessToken();
    const resp = await fetch(`${config.apiBaseUrl}/api/price-list/pdf`, {
      headers: { Authorization: `Bearer ${access ?? ''}` },
      signal: fetchTimeoutSignal(),
    });
    if (!resp.ok) {
      throw await httpError(resp);
    }
    return resp.blob();
  },
};
