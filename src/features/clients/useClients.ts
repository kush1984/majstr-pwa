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

export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: ClientRequest) => clientsApi.create(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: CLIENTS_KEY }),
  });
}
