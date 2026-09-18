import { api } from './client.ts';
import type {
  CashEntryKind,
  CashEntryRequest,
  CashEntryResponse,
  CashFlowResponse,
  CashSummaryResponse,
} from './types.ts';

/**
 * «Мої гроші» (V135) — the master's own cash movement.
 *
 * The first surface in this API that is about the MASTER rather than about a job: every other money
 * endpoint is addressed `/api/projects/{id}/…`. What it returns is a UNION — client payments and
 * spending from all his objects, plus the rows no object knows about (fuel, tools, taxes, income for
 * work that closed without an act).
 */
export const cashApi = {
  /**
   * One period's movement. Both bounds inclusive; omit them for the current month in Kyiv.
   *
   * `monthly` is the YEAR view: per-month totals and an EMPTY entry list. Two thousand rows is not
   * a screen anyone reads on a phone, and the master drills into a month by re-querying it.
   */
  flow(params: { from?: string; to?: string; monthly?: boolean } = {}): Promise<CashFlowResponse> {
    return api
      .get<CashFlowResponse>('/api/cash', {
        params: {
          from: params.from,
          to: params.to,
          ...(params.monthly ? { monthly: true } : {}),
        },
      })
      .then((r) => r.data);
  },

  /** This month in three numbers, for the one-line home strip. */
  summary(): Promise<CashSummaryResponse> {
    return api.get<CashSummaryResponse>('/api/cash/summary').then((r) => r.data);
  },

  /**
   * Add income or spending — always the master's OWN row.
   *
   * It asks nothing about an object: object money is already in that object's journal and shows up
   * on the read path by itself.
   */
  add(req: CashEntryRequest, id?: string): Promise<CashEntryResponse> {
    return api
      .post<CashEntryResponse>('/api/cash', req, id ? { headers: { 'X-Entity-Uuid': id } } : undefined)
      .then((r) => r.data);
  },

  /**
   * Edit ANY row — his own, or an object's payment/expense. `req.kind` says which; the write lands
   * in that object's own table, so its rules still apply (an expense a till receipt owns is
   * refused, and the master is sent to the receipt).
   */
  update(id: string, req: CashEntryRequest): Promise<CashEntryResponse> {
    return api.patch<CashEntryResponse>(`/api/cash/${id}`, req).then((r) => r.data);
  },

  remove(id: string, kind: CashEntryKind): Promise<void> {
    return api.delete(`/api/cash/${id}`, { params: { kind } }).then(() => undefined);
  },
};
