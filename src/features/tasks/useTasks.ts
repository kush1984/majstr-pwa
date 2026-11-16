import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tasksApi } from '@/api/tasks.ts';
import { newUuid } from '@/lib/uuid.ts';
import { offlineMutate } from '@/lib/outbox/offlineMutation.ts';
import type { TaskResponse, TaskUpdateRequest } from '@/api/types.ts';

/** Exported so the offline prefetch and the inbox can refresh the SAME key this hook reads. */
export const TASKS_KEY = (objectId: string) => ['project-tasks', objectId] as const;
const key = TASKS_KEY;

/** Open first in the order written, then done ones, the most recently ticked first — the server's order. */
export function sortTasks(list: TaskResponse[]): TaskResponse[] {
  return [...list].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.done) return (b.doneAt ?? '').localeCompare(a.doneAt ?? '');
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export function useTasks(objectId: string) {
  return useQuery({
    queryKey: key(objectId),
    queryFn: () => tasksApi.list(objectId),
    enabled: Boolean(objectId),
  });
}

/**
 * Task CRUD — offline-first like notes: a task is written on site, and ticking one off happens
 * there too. Every action queues and replays; the create is idempotent through its client id.
 */
export function useTaskActions(objectId: string) {
  const qc = useQueryClient();
  const invalidate = () => { void qc.invalidateQueries({ queryKey: key(objectId) }); };
  const patch = (edit: (list: TaskResponse[]) => TaskResponse[]) => {
    qc.setQueryData<TaskResponse[]>(key(objectId), (old) => sortTasks(edit(old ?? [])));
  };
  const cancel = () => qc.cancelQueries({ queryKey: key(objectId) });

  return {
    add: useMutation({
      networkMode: 'always',
      mutationFn: (body: string) => {
        const id = newUuid();
        const req = { body };
        return offlineMutate<void>({
          entity: 'task', entityId: id, type: 'create', payload: { objectId, req },
          deps: [objectId],
          online: async () => { await tasksApi.add(objectId, req, id); },
          cancel,
          onOnlineSuccess: invalidate,
          optimistic: () => patch((list) => [...list, {
            id, body, done: false, createdAt: new Date().toISOString(),
          }]),
        });
      },
    }),
    update: useMutation({
      networkMode: 'always',
      mutationFn: (vars: { taskId: string; req: TaskUpdateRequest }) =>
        offlineMutate<void>({
          entity: 'task', entityId: vars.taskId, type: 'update',
          payload: { objectId, req: vars.req }, deps: [objectId],
          online: async () => { await tasksApi.update(objectId, vars.taskId, vars.req); },
          cancel,
          onOnlineSuccess: invalidate,
          optimistic: () => patch((list) => list.map((task) => {
            if (task.id !== vars.taskId) return task;
            const done = vars.req.done ?? task.done;
            return {
              ...task,
              body: vars.req.body ?? task.body,
              done,
              doneAt: done ? (task.doneAt ?? new Date().toISOString()) : undefined,
            };
          })),
        }),
    }),
    remove: useMutation({
      networkMode: 'always',
      mutationFn: (taskId: string) =>
        offlineMutate<void>({
          entity: 'task', entityId: taskId, type: 'delete', payload: { objectId },
          deps: [objectId],
          online: async () => { await tasksApi.remove(objectId, taskId); },
          cancel,
          onOnlineSuccess: invalidate,
          optimistic: () => patch((list) => list.filter((task) => task.id !== taskId)),
        }),
    }),
  };
}
