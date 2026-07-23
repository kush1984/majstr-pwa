import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { useCreateProject, PROJECTS_KEY } from './useProjects.ts';
import { clearOutbox, listOutbox } from '@/lib/outbox/outbox.ts';
import type { ProjectResponse } from '@/api/types.ts';

// Drive the OFFLINE branch (optimistic + queued).
beforeEach(async () => { await clearOutbox(); onlineManager.setOnline(false); });
afterEach(() => onlineManager.setOnline(true));

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

const listKey = [...PROJECTS_KEY, 'list', 'all'];

describe('useCreateProject — offline-first', () => {
  it('optimistically prepends the object and queues a create with NO deps when there is no client', async () => {
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useCreateProject(), { wrapper });

    let created: ProjectResponse | undefined;
    await act(async () => {
      created = await result.current.mutateAsync({ name: 'Хата', address: 'вул. 1' });
    });

    expect(created?.id).toBeTruthy();
    expect(qc.getQueryData<ProjectResponse[]>(listKey)?.[0].id).toBe(created!.id);
    const ops = await listOutbox();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ entityId: created!.id, entity: 'project', type: 'create', deps: [] });
  });

  it('depends on the client op when the object references an offline-created client', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateProject(), { wrapper });

    let created: ProjectResponse | undefined;
    await act(async () => {
      created = await result.current.mutateAsync({ name: 'Хата', address: 'вул. 1', clientId: 'client-uuid' });
    });

    const ops = await listOutbox();
    // The project waits for its client to sync first (dependency-ordered replay).
    expect(ops[0]).toMatchObject({ entityId: created!.id, entity: 'project', deps: ['client-uuid'] });
  });
});
