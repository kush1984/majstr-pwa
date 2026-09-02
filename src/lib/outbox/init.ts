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
import { actsApi } from '@/api/acts.ts';
import { fromQueuedFile } from './queuedFile.ts';
import { ACT_RECEIPT_ENTITY, type ActReceiptOpPayload } from '@/features/acts/offlineReceipts.ts';
import type {
  EstimateItemsOrderRequest,
  BatchCatalogItemEntry, CatalogItemRequest, ClientRequest, EstimateCreateRequest,
  EstimateItemFromCatalogRequest, EstimateItemRequest,
  EstimateUpdateRequest, ExpenseRequest, MeasurementItemRequest, MeasurementRoomRequest,
  NoteRequest, ProjectRequest,
  ProjectStatus, TemplateItemRequest, TemplateItemsOrderRequest, Trade,
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

  // Trimming many lines at once. entityId is the ESTIMATE, because the op is about a set of its
  // lines rather than any one of them — and it stays ONE op deliberately: queueing 130 separate
  // deletions would give the replay 130 chances to stop half-way through a trim the master already
  // saw finish on screen.
  //
  // Ids already gone are skipped server-side, so a replay after a partial success is a no-op for
  // what landed and completes the rest.
  registerOutboxHandler('estimateItemsBulkDelete', async (op) => {
    const p = op.payload as { itemIds: string[] };
    await estimatesApi.deleteItems(op.entityId, p.itemIds);
  });

  // The arrangement of an estimate's lines after a drag. entityId is the ESTIMATE — the op is
  // about the whole list, not one line — and it is queued with `enqueueLatest`, so several drags
  // made offline collapse into the one arrangement the master ended on.
  //
  // deps on the estimate id, so an estimate authored offline is created before anything tries to
  // reorder inside it. Lines created in the same offline session are NOT listed as deps: the
  // server keeps any line an arrangement does not mention (appending it after the rest), so a
  // reorder that lands before its lines do is harmless — they simply arrive already positioned.
  registerOutboxHandler('estimateItemOrder', async (op) => {
    const p = op.payload as { req: EstimateItemsOrderRequest };
    await estimatesApi.reorderItems(op.entityId, p.req);
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
      const p = op.payload as
        | { op: 'rename'; name: string; description?: string }
        | { op: 'trade'; trade: Trade | null };
      if (p.op === 'rename') {
        // `description` stays THREE-valued across the queue: absent replays as «leave it as it
        // is». Defaulting it to '' here would clear the paragraph the client reads on every
        // offline rename (V121).
        await estimateTemplatesApi.rename(op.entityId, {
          name: p.name, description: p.description,
        });
      } else {
        await estimateTemplatesApi.setTrade(op.entityId, { trade: p.trade });
      }
    } else if (op.type === 'delete') {
      await estimateTemplatesApi.remove(op.entityId);
    } else {
      // A handler that just falls through RESOLVES, and the engine then deletes the op as
      // synced — the write disappears with no error anywhere. Fail loudly instead: the op gets
      // classified, surfaces in the sync sheet, and the master can see something went wrong.
      throw new Error(`estimateTemplate: unsupported op type "${op.type}"`);
    }
  });

  // Template positions — entityId is the ITEM id; the template id rides the payload.
  registerOutboxHandler('templateItem', async (op) => {
    const p = op.payload as { templateId: string; req?: TemplateItemRequest };
    if (op.type === 'create') {
      await estimateTemplatesApi.addItem(p.templateId, p.req!, op.entityId);
    } else if (op.type === 'update') {
      await estimateTemplatesApi.updateItem(p.templateId, op.entityId, p.req!);
    } else if (op.type === 'delete') {
      await estimateTemplatesApi.removeItem(p.templateId, op.entityId);
    } else {
      throw new Error(`templateItem: unsupported op type "${op.type}"`); // see note above
    }
  });

  // The arrangement of a template's positions after a drag. entityId is the TEMPLATE, and it is
  // queued with `enqueueLatest` — several drags made offline collapse into the one the master
  // ended on. Its own entity rather than an `estimateTemplate` update: coalescing keys on
  // entity+entityId+type, so sharing that entity would let a reorder swallow a queued rename.
  //
  // Positions added in the same offline session are NOT deps: the server keeps any position an
  // arrangement does not mention (appending it after the rest), so an order that lands first is
  // harmless.
  registerOutboxHandler('templateItemOrder', async (op) => {
    const p = op.payload as { req: TemplateItemsOrderRequest };
    await estimateTemplatesApi.reorderItems(op.entityId, p.req);
  });

  // An act receipt photographed offline (offline-act-receipts). CREATE only, and deliberately so:
  // the master photographs the paper and types the amount and the date, nothing is read for him
  // and nothing is re-read later. The photo rides the payload as BYTES (see queuedFile.ts).
  //
  // Replaying with the op's entityId as X-Entity-Uuid is what makes a retry safe: a receipt that
  // already landed comes back as the existing row instead of duplicating money in the act AND in
  // the ADDENDUM estimate its receipts roll into on signing.
  //
  // The gallery copy needs no second op — `saveToPhotos` rides this same request, and the backend
  // makes that copy in a REQUIRES_NEW transaction it swallows failures from, so it can never cost
  // the master the receipt itself.
  registerOutboxHandler(ACT_RECEIPT_ENTITY, async (op) => {
    const p = op.payload as ActReceiptOpPayload;
    if (op.type !== 'create') {
      // Editing or deleting a receipt that has not synced yet is done in the QUEUE
      // (patchPendingCreate / dropPendingCreate), never as an op of its own — there is no server
      // row to address. Reaching here means a build changed that; fail loudly. See note above.
      throw new Error(`actReceipt: unsupported op type "${op.type}"`);
    }
    await actsApi.addReceipt(p.actId, {
      id: op.entityId,
      label: p.label,
      amount: p.amount,
      issuedAt: p.issuedAt,
      saveToPhotos: p.saveToPhotos,
      file: fromQueuedFile(p.file),
    });
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
      return 'retry'; // 5xx and the rest — worth another go
    }
    // A network blip has no response but IS an axios error; anything else here is our own bug
    // (a malformed payload from an older build hitting `p.req!`, a missing handler branch).
    // Retrying can't fix code, and pretending it might burned all 8 attempts before the op
    // finally showed up as "stuck" — surface it immediately instead.
    if (axios.isAxiosError(e)) return 'retry';
    return 'other';
  });

  initSyncStatus(); // publish the queued-op count (leftovers from a prior offline session)
  // On reconnect, replay the queue; if anything landed, refetch so the cache reflects the server.
  return startOutboxSync((r) => {
    if (r.synced > 0) void qc.invalidateQueries();
  });
}
