import type { QueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { initSyncStatus, registerOutboxHandler, setOutboxErrorClassifier, startOutboxSync } from './outbox.ts';
import { clientsApi } from '@/api/clients.ts';
import { projectsApi } from '@/api/projects.ts';
import { estimatesApi } from '@/api/estimates.ts';
import { measurementsApi } from '@/api/measurements.ts';
import { catalogApi } from '@/api/catalog.ts';
import { estimateTemplatesApi } from '@/api/estimateTemplates.ts';
import { notesApi } from '@/api/notes.ts';
import { economyApi } from '@/api/economy.ts';
import type {
  BatchCatalogItemEntry, CatalogItemRequest, ClientRequest, EstimateCreateRequest,
  EstimateItemFromCatalogRequest, EstimateItemRequest,
  EstimateUpdateRequest, ExpenseRequest, MeasurementItemRequest, MeasurementRoomRequest,
  NoteRequest, ProjectRequest,
  ProjectStatus, TemplateItemRequest, Trade,
} from '@/api/types.ts';

/**
 * Wire the outbox at app startup: register a network handler per entity, then auto-flush on every
 * reconnect (`startOutboxSync`) and reconcile the query cache after a successful sync. Called once
 * from `main.tsx` with the shared QueryClient. As more entities gain offline authoring
 * (objects, estimates, measurements) their handlers are registered here.
 */
export function initOutbox(qc: QueryClient): () => void {
  registerOutboxHandler('client', async (op) => {
    const req = op.payload as ClientRequest;
    if (op.type === 'create') {
      await clientsApi.create(req, op.entityId);
    } else if (op.type === 'update') {
      await clientsApi.update(op.entityId, req);
    } else {
      await clientsApi.remove(op.entityId);
    }
  });

  registerOutboxHandler('project', async (op) => {
    const req = op.payload as ProjectRequest;
    if (op.type === 'create') {
      await projectsApi.create(req, op.entityId);
    } else if (op.type === 'update') {
      await projectsApi.update(op.entityId, req);
    } else {
      await projectsApi.remove(op.entityId);
    }
  });

  // Object status — a SEPARATE handler rather than another branch of 'project'. A queue can
  // outlive an app update, and reshaping the existing 'project' update payload would break any
  // op already sitting in a master's IndexedDB. A new entity name costs nothing and can't.
  registerOutboxHandler('projectStatus', async (op) => {
    const p = op.payload as { status: ProjectStatus };
    await projectsApi.setStatus(op.entityId, p.status);
  });

  // Estimate — entityId is the estimate id; create carries the project id in its payload.
  registerOutboxHandler('estimate', async (op) => {
    if (op.type === 'create') {
      const p = op.payload as { projectId: string; req: EstimateCreateRequest };
      await estimatesApi.createForProject(p.projectId, p.req, op.entityId);
    } else if (op.type === 'update') {
      const p = op.payload as { req: EstimateUpdateRequest };
      await estimatesApi.update(op.entityId, p.req);
    } else {
      await estimatesApi.remove(op.entityId);
    }
  });

  // Estimate line items — the op's entityId is the ITEM id; the estimate id rides the payload.
  registerOutboxHandler('estimateItem', async (op) => {
    const p = op.payload as { estimateId: string; req?: EstimateItemRequest };
    if (op.type === 'create') {
      await estimatesApi.addItem(p.estimateId, p.req!, op.entityId);
    } else if (op.type === 'update') {
      await estimatesApi.updateItem(p.estimateId, op.entityId, p.req!);
    } else {
      await estimatesApi.removeItem(p.estimateId, op.entityId);
    }
  });

  // Lines copied from the catalog. Replayed through the FROM-CATALOG endpoint, not the plain
  // item add: a catalog position may legally cost 0 (V27/V29 relaxed the CHECKs for exactly
  // that), while the validated add form demands >= 0.01 — so routing these through `addItem`
  // would queue such lines happily and have the server reject them on replay.
  registerOutboxHandler('estimateItemFromCatalog', async (op) => {
    const p = op.payload as {
      estimateId: string; catalogItemId: string; req: EstimateItemFromCatalogRequest;
    };
    await estimatesApi.addItemFromCatalog(p.estimateId, p.catalogItemId, p.req, op.entityId);
  });

  // A multi-select add stays ONE op carrying the whole selection: online it is still a single
  // round trip, and each entry has its own client id, so a partially-applied batch resumes per
  // line instead of duplicating everything that already landed.
  registerOutboxHandler('estimateItemsFromCatalogBatch', async (op) => {
    const p = op.payload as { estimateId: string; items: BatchCatalogItemEntry[] };
    await estimatesApi.addItemsFromCatalogBatch(p.estimateId, p.items);
  });

  // Measurement rooms — entityId is the ROOM id; the object id rides the payload.
  registerOutboxHandler('measurementRoom', async (op) => {
    const p = op.payload as { objectId: string; req?: MeasurementRoomRequest };
    if (op.type === 'create') {
      await measurementsApi.addRoom(p.objectId, p.req!, op.entityId);
    } else if (op.type === 'update') {
      await measurementsApi.updateRoom(p.objectId, op.entityId, p.req!);
    } else {
      await measurementsApi.deleteRoom(p.objectId, op.entityId);
    }
  });

  // Measurement elements — entityId is the ITEM id; object + room ids ride the payload.
  registerOutboxHandler('measurementItem', async (op) => {
    const p = op.payload as { objectId: string; roomId: string; req?: MeasurementItemRequest };
    if (op.type === 'create') {
      await measurementsApi.addItem(p.objectId, p.roomId, p.req!, op.entityId);
    } else if (op.type === 'update') {
      await measurementsApi.updateItem(p.objectId, p.roomId, op.entityId, p.req!);
    } else {
      await measurementsApi.deleteItem(p.objectId, p.roomId, op.entityId);
    }
  });

  // Object notes — entityId is the NOTE id; the object id rides the payload.
  registerOutboxHandler('note', async (op) => {
    const p = op.payload as { objectId: string; req?: NoteRequest };
    if (op.type === 'create') {
      await notesApi.add(p.objectId, p.req!, op.entityId);
    } else if (op.type === 'update') {
      await notesApi.update(p.objectId, op.entityId, p.req!);
    } else {
      await notesApi.remove(p.objectId, op.entityId);
    }
  });

  // Object expenses (PRO) — entityId is the EXPENSE id; the object id rides the payload.
  registerOutboxHandler('expense', async (op) => {
    const p = op.payload as { objectId: string; req?: ExpenseRequest };
    if (op.type === 'create') {
      await economyApi.addExpense(p.objectId, p.req!, op.entityId);
    } else if (op.type === 'update') {
      await economyApi.updateExpense(p.objectId, op.entityId, p.req!);
    } else {
      await economyApi.deleteExpense(p.objectId, op.entityId);
    }
  });

  // Catalog positions — entityId is the item id.
  registerOutboxHandler('catalogItem', async (op) => {
    const req = op.payload as CatalogItemRequest;
    if (op.type === 'create') {
      await catalogApi.create(req, op.entityId);
    } else if (op.type === 'update') {
      await catalogApi.update(op.entityId, req);
    } else {
      await catalogApi.remove(op.entityId);
    }
  });

  // Own templates — rename / re-file / delete. Templates are never CREATED offline
  // (save-as-template reads a server-side estimate), so there is no create branch.
  registerOutboxHandler('estimateTemplate', async (op) => {
    if (op.type === 'update') {
      const p = op.payload as { op: 'rename'; name: string } | { op: 'trade'; trade: Trade | null };
      if (p.op === 'rename') await estimateTemplatesApi.rename(op.entityId, { name: p.name });
      else await estimateTemplatesApi.setTrade(op.entityId, { trade: p.trade });
    } else if (op.type === 'delete') {
      await estimateTemplatesApi.remove(op.entityId);
    }
  });

  // Template positions — entityId is the ITEM id; the template id rides the payload.
  registerOutboxHandler('templateItem', async (op) => {
    const p = op.payload as { templateId: string; req?: TemplateItemRequest };
    if (op.type === 'create') {
      await estimateTemplatesApi.addItem(p.templateId, p.req!, op.entityId);
    } else if (op.type === 'delete') {
      await estimateTemplatesApi.removeItem(p.templateId, op.entityId);
    }
  });

  // Classify replay failures: a NETWORK blip / 5xx / 429 retries; a permanent 4xx blocks the op for
  // a user decision — a 403 with a *_LIMIT_REACHED code means "over the FREE limit → offer PRO".
  setOutboxErrorClassifier((e) => {
    if (axios.isAxiosError(e) && e.response) {
      const s = e.response.status;
      // 401/403 is an AUTH problem, not a rejected write: the token rotated mid-replay, or the
      // session needs a re-login. Keep the op queued — telling the master "pay or delete your
      // work" over an expired token would be a lie (and could cost them real data).
      if (s === 401 || s === 403) {
        const code = (e.response.data as { code?: string } | undefined)?.code ?? '';
        return code.includes('LIMIT') ? 'limit' : 'retry';
      }
      if (s >= 400 && s < 500 && s !== 408 && s !== 429) {
        const code = (e.response.data as { code?: string } | undefined)?.code ?? '';
        return code.includes('LIMIT') ? 'limit' : 'other';
      }
    }
    return 'retry';
  });

  initSyncStatus(); // publish the queued-op count (leftovers from a prior offline session)
  // On reconnect, replay the queue; if anything landed, refetch so the cache reflects the server.
  return startOutboxSync((r) => {
    if (r.synced > 0) void qc.invalidateQueries();
  });
}
