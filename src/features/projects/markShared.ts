import type { QueryClient } from '@tanstack/react-query';
import { offlineMutate } from '@/lib/outbox/offlineMutation.ts';
import { estimateShareApi, portalApi } from '@/api/portal.ts';

/**
 * DRAFT → SENT once the link actually LEFT the app — shared, copied or emailed — never on opening
 * the sheet (review P1-9). `id` is the estimate for a `?t=` link, the object for its portal.
 * Offline it is queued like any other write; a queued mark coalesces, being idempotent.
 */
export async function markShared(qc: QueryClient, scope: 'estimate' | 'object', id: string): Promise<void> {
  await offlineMutate({
    entity: 'shareMarkSent',
    entityId: id,
    type: 'update',
    payload: { scope },
    coalesce: true,
    online: () => (scope === 'estimate' ? estimateShareApi.markSent(id) : portalApi.markSent(id)),
    optimistic: () => undefined,
  });
  void qc.invalidateQueries({ queryKey: ['projects'] });
  void qc.invalidateQueries({ queryKey: ['dashboard'] });
  void qc.invalidateQueries({ queryKey: ['project-estimates'] });
  void qc.invalidateQueries({ queryKey: ['estimate'] });
}
