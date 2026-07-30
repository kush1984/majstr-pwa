import { api } from './client.ts';
import type {
  MeasurementsResponse,
  ProjectImportCommitRequest,
  ProjectImportParseResponse,
  ProjectTriageResult,
  ProjectTriageSheet,
} from './types.ts';
import type { DocKind } from '@/lib/projectDocs.ts';

/**
 * Project-documentation import. One file per parse call — the client-side
 * classifier picked the kind (and floor, which stays client-side: the sheet
 * merges results and stamps the floor from the FILENAME, never from a table).
 * Nothing is stored server-side; commit creates the confirmed rooms.
 */
export const projectImportApi = {
  /**
   * Ask what the sheets ARE before paying to read any of them.
   *
   * Text only, one call for the whole set: a title block lives in the text layer, so this costs a
   * fraction of a single page-image call and it answers the question the keyword lists used to guess
   * at — including for titles in Russian or English, which they never matched.
   */
  triage(objectId: string, sheets: ProjectTriageSheet[]): Promise<ProjectTriageResult[]> {
    return api
      .post<{ sheets: ProjectTriageResult[] }>(
        `/api/projects/${objectId}/measurements/project/triage`, { sheets })
      .then((r) => r.data.sheets ?? []);
  },

  parse(objectId: string, file: Blob, filename: string, kind: DocKind): Promise<ProjectImportParseResponse> {
    const form = new FormData();
    form.append('file', file, filename);
    form.append('kind', kind);
    return api
      .post<ProjectImportParseResponse>(`/api/projects/${objectId}/measurements/project/parse`, form)
      .then((r) => r.data);
  },

  commit(objectId: string, req: ProjectImportCommitRequest): Promise<MeasurementsResponse> {
    return api
      .post<MeasurementsResponse>(`/api/projects/${objectId}/measurements/project/commit`, req)
      .then((r) => r.data);
  },
};
