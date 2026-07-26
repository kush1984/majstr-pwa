import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { useCreateProject, useDeleteProject, useSetProjectStatus, PROJECTS_KEY } from './useProjects.ts';
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

describe('object status + delete — offline (the FREE-limit dead end)', () => {
  it('queues a status change and patches both the list and the detail cache', async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData(listKey, [{ id: 'p1', name: 'Хата', status: 'DRAFT' } as ProjectResponse]);
    qc.setQueryData([...PROJECTS_KEY, 'detail', 'p1'], { id: 'p1', name: 'Хата', status: 'DRAFT' });
    const { result } = renderHook(() => useSetProjectStatus(), { wrapper });

    await act(async () => { await result.current.mutateAsync({ id: 'p1', status: 'IN_PROGRESS' }); });

    expect(qc.getQueryData<ProjectResponse[]>(listKey)![0].status).toBe('IN_PROGRESS');
    expect(qc.getQueryData<ProjectResponse>([...PROJECTS_KEY, 'detail', 'p1'])!.status).toBe('IN_PROGRESS');
    const ops = await listOutbox();
    expect(ops).toHaveLength(1);
    // A separate entity from 'project' on purpose: a queue can outlive an app update, so the
    // existing project-update payload shape must not be reshaped under ops already stored.
    expect(ops[0].entity).toBe('projectStatus');
    expect(ops[0].payload).toEqual({ status: 'IN_PROGRESS' });
  });

  it('queues a delete and removes the object optimistically', async () => {
    // Before this, delete had no networkMode:'always', so offline TanStack Query PAUSED it:
    // the master tapped delete, nothing happened, and closing the app lost it entirely. Worse,
    // an over-limit master is told to "delete something" — advice they could not follow.
    const { qc, wrapper } = setup();
    qc.setQueryData(listKey, [
      { id: 'p1', name: 'Хата' } as ProjectResponse,
      { id: 'p2', name: 'Дача' } as ProjectResponse,
    ]);
    const { result } = renderHook(() => useDeleteProject(), { wrapper });

    await act(async () => { await result.current.mutateAsync('p1'); });

    expect(qc.getQueryData<ProjectResponse[]>(listKey)!.map((p) => p.id)).toEqual(['p2']);
    const ops = await listOutbox();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ entity: 'project', entityId: 'p1', type: 'delete' });
  });
});
