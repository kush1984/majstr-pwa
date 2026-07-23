import type { QueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { initSyncStatus, registerOutboxHandler, setOutboxErrorClassifier, startOutboxSync } from './outbox.ts';
import { clientsApi } from '@/api/clients.ts';
import { projectsApi } from '@/api/projects.ts';
import { estimatesApi } from '@/api/estimates.ts';
import type { ClientRequest, EstimateCreateRequest, EstimateItemRequest, ProjectRequest } from '@/api/types.ts';

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

  // Estimate create — entityId is the estimate id; the project id rides the payload.
  registerOutboxHandler('estimate', async (op) => {
    const p = op.payload as { projectId: string; req: EstimateCreateRequest };
    if (op.type === 'create') {
      await estimatesApi.createForProject(p.projectId, p.req, op.entityId);
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

  // Classify replay failures: a NETWORK blip / 5xx / 429 retries; a permanent 4xx blocks the op for
  // a user decision — a 403 with a *_LIMIT_REACHED code means "over the FREE limit → offer PRO".
  setOutboxErrorClassifier((e) => {
    if (axios.isAxiosError(e) && e.response) {
      const s = e.response.status;
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
