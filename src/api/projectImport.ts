import { api } from './client.ts';
import type {
  MeasurementsResponse,
  ProjectImportCommitRequest,
  ProjectImportParseResponse,
} from './types.ts';
import type { DocKind } from '@/lib/projectDocs.ts';

/**
 * Project-documentation import. One file per parse call — the client-side
 * classifier picked the kind (and floor, which stays client-side: the sheet
 * merges results and stamps the floor from the FILENAME, never from a table).
 * Nothing is stored server-side; commit creates the confirmed rooms.
 */
export const projectImportApi = {
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
