import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clientsApi } from '@/api/clients.ts';
import type { ClientRequest } from '@/api/types.ts';

export const CLIENTS_KEY = ['clients'] as const;

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

export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: ClientRequest) => clientsApi.create(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: CLIENTS_KEY }),
  });
}

export function useUpdateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; req: ClientRequest }) =>
      clientsApi.update(args.id, args.req),
    onSuccess: () => qc.invalidateQueries({ queryKey: CLIENTS_KEY }),
  });
}
