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
  parse(objectId: string, file: File): Promise<SketchParseResponse> {
    const form = new FormData();
    form.append('file', file);
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
