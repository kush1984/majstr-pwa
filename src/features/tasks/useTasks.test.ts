import { describe, it, expect } from 'vitest';
import { sortTasks } from './useTasks.ts';
import type { TaskResponse } from '@/api/types.ts';

const task = (id: string, createdAt: string, doneAt?: string): TaskResponse => ({
  id, body: id, done: doneAt !== undefined, doneAt, createdAt,
});

describe('sortTasks — the server order, kept by an optimistic patch', () => {
  it('puts open tasks first in the order written, then done ones, the latest ticked first', () => {
    const sorted = sortTasks([
      task('done-early', '2026-10-01T08:00:00Z', '2026-10-02T08:00:00Z'),
      task('open-second', '2026-10-03T08:00:00Z'),
      task('done-late', '2026-10-01T09:00:00Z', '2026-10-04T08:00:00Z'),
      task('open-first', '2026-10-02T08:00:00Z'),
    ]);

    expect(sorted.map((t) => t.id)).toEqual(['open-first', 'open-second', 'done-late', 'done-early']);
  });
});
