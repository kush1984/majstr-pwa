import 'fake-indexeddb/auto';
import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { useCreateClient, useUpdateClient, CLIENTS_KEY } from './useClients.ts';
import { clearOutbox, listOutbox } from '@/lib/outbox/outbox.ts';
import type { ClientResponse } from '@/api/types.ts';

// Drive the OFFLINE branch: writes go optimistic + into the outbox (online would call the real API).
beforeEach(async () => { await clearOutbox(); onlineManager.setOnline(false); });
afterEach(() => onlineManager.setOnline(true));

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

const listKey = [...CLIENTS_KEY, 'list'];

describe('useClients — offline authoring (queued)', () => {
  it('create: optimistic insert + a queued outbox create carrying the client UUID', async () => {
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useCreateClient(), { wrapper });

    let created: ClientResponse | undefined;
    await act(async () => {
      created = await result.current.mutateAsync({ fullName: 'Іван', phone: '+380671112233' });
    });

    // Returned immediately with a client-generated id — usable before it syncs.
    expect(created?.id).toBeTruthy();
    expect(created?.fullName).toBe('Іван');
    // Optimistically present in the list cache.
    expect(qc.getQueryData<ClientResponse[]>(listKey)?.some((c) => c.id === created!.id)).toBe(true);
    // And queued for replay, keyed by that same id (→ idempotent create on the server).
    const ops = await listOutbox();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ entityId: created!.id, entity: 'client', type: 'create' });
  });

  it('update: patches the cache optimistically and queues an update op', async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData<ClientResponse[]>(listKey, [
      { id: 'c1', fullName: 'Старе', phone: '+1', address: null, email: null, clientType: 'PERSON',
        taxId: null, legalName: null, legalAddress: null, signatoryTitle: null, signatoryName: null,
        createdAt: '2026-01-01' },
    ]);
    const { result } = renderHook(() => useUpdateClient(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 'c1', req: { fullName: 'Нове', phone: '+2' } });
    });

    expect(qc.getQueryData<ClientResponse[]>(listKey)?.[0].fullName).toBe('Нове');
    const ops = await listOutbox();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ entityId: 'c1', entity: 'client', type: 'update' });
  });
});
