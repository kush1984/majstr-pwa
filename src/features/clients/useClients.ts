import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clientsApi } from '@/api/clients.ts';
import { newUuid } from '@/lib/uuid.ts';
import { offlineMutate } from '@/lib/outbox/offlineMutation.ts';
import type { ClientRequest, ClientResponse } from '@/api/types.ts';

export const CLIENTS_KEY = ['clients'] as const;
const listKey = [...CLIENTS_KEY, 'list'] as const;

const byName = (a: ClientResponse, b: ClientResponse) => a.fullName.localeCompare(b.fullName, 'uk');

export function useClients() {
  return useQuery({
    queryKey: [...CLIENTS_KEY, 'list'],
    queryFn: () => clientsApi.list(),
  });
}

export function useClient(id: string, enabled = true) {
  return useQuery({
    queryKey: [...CLIENTS_KEY, 'detail', id],
    queryFn: () => clientsApi.get(id),
    enabled: enabled && Boolean(id),
  });
}

/**
 * Create a client — offline-first. A client-generated UUID lets the row appear instantly
 * (optimistic) and the create ride the outbox: it's queued, replayed when online, and idempotent
 * on the backend (the id in the X-Entity-Uuid header). Callers get the client (with its id) back
 * immediately, so attaching it to an estimate/object works even before it has synced.
 */
export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    // 'always' so the mutation RUNS while offline (the default 'online' pauses it) — offlineMutate
    // then queues it instead of the mutation hanging until reconnect.
    networkMode: 'always',
    mutationFn: (req: ClientRequest): Promise<ClientResponse> => {
      const id = newUuid();
      const optimistic: ClientResponse = {
        id, fullName: req.fullName, phone: req.phone,
        address: req.address ?? null, email: req.email ?? null,
        clientType: req.clientType ?? 'PERSON',
        taxId: req.taxId ?? null,
        legalName: req.legalName ?? null,
        legalAddress: req.legalAddress ?? null,
        signatoryTitle: req.signatoryTitle ?? null,
        signatoryName: req.signatoryName ?? null,
        createdAt: new Date().toISOString(),
      };
      return offlineMutate<ClientResponse>({
        entity: 'client', entityId: id, type: 'create', payload: req, deps: [],
        online: () => clientsApi.create(req, id),
        onOnlineSuccess: () => void qc.invalidateQueries({ queryKey: CLIENTS_KEY }),
        optimistic: () => {
          qc.setQueryData<ClientResponse[]>(listKey, (old) => [...(old ?? []), optimistic].sort(byName));
          qc.setQueryData<ClientResponse>([...CLIENTS_KEY, 'detail', id], optimistic);
          return optimistic;
        },
      });
    },
  });
}

export function useUpdateClient() {
  const qc = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: ({ id, req }: { id: string; req: ClientRequest }): Promise<void> => {
      const patch = (c: ClientResponse): ClientResponse => ({
        ...c, fullName: req.fullName, phone: req.phone, address: req.address ?? null, email: req.email ?? null,
      });
      return offlineMutate<void>({
        entity: 'client', entityId: id, type: 'update', payload: req, deps: [],
        online: async () => { await clientsApi.update(id, req); },
        onOnlineSuccess: () => void qc.invalidateQueries({ queryKey: CLIENTS_KEY }),
        optimistic: () => {
          qc.setQueryData<ClientResponse[]>(listKey, (old) => (old ?? []).map((c) => (c.id === id ? patch(c) : c)).sort(byName));
          qc.setQueryData<ClientResponse>([...CLIENTS_KEY, 'detail', id], (old) => (old ? patch(old) : old));
        },
      });
    },
  });
}
