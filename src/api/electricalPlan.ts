import { api } from './client.ts';
import type { ElectricalPlanParseResponse } from './types.ts';

/**
 * Count electrical points off a plan (PDF/photo) via LLM vision (PRO). Parse only —
 * nothing is persisted; the confirmed counts are committed through the ordinary
 * "add measurement element" call as an ELECTRICAL_POINTS element (unit шт).
 */
export const electricalPlanApi = {
  parse(objectId: string, file: File): Promise<ElectricalPlanParseResponse> {
    const form = new FormData();
    form.append('file', file);
    return api
      .post<ElectricalPlanParseResponse>(
        `/api/projects/${objectId}/measurements/electrical/plan/parse`,
        form,
      )
      .then((r) => r.data);
  },
};
