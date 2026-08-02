import { api } from './client.ts';
import type {
  MeasurementsResponse,
  SketchCommitRequest,
  SketchParseResponse,
} from './types.ts';

/**
 * Sketch import (PRO) — recognise a hand-drawn room sketch photo into a DRAFT set of
 * measurements the master verifies against our redrawn schema, then commits. The parse
 * step persists nothing (the image is discarded server-side); commit creates the rooms +
 * elements and returns the fresh measurement tree.
 */
export const sketchImportApi = {
  /**
   * Several sheets go up under the SAME field name — that is how a multipart form carries a list,
   * and the backend binds the repeated field into an array. One photo is simply a one-item list.
   */
  parse(objectId: string, files: File[]): Promise<SketchParseResponse> {
    const form = new FormData();
    for (const file of files) form.append('file', file);
    return api
      .post<SketchParseResponse>(`/api/projects/${objectId}/measurements/sketch/parse`, form)
      .then((r) => r.data);
  },

  commit(objectId: string, req: SketchCommitRequest): Promise<MeasurementsResponse> {
    return api
      .post<MeasurementsResponse>(`/api/projects/${objectId}/measurements/sketch/commit`, req)
      .then((r) => r.data);
  },
};
