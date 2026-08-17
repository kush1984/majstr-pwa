import { describe, it, expect } from 'vitest';
import { matches } from './ProjectsPage.tsx';
import type { ObjectStage, ProjectResponse } from '@/api/types.ts';

function project(stage: ObjectStage): ProjectResponse {
  return {
    id: 'p1', name: 'Хата', address: 'вул. 1', status: 'DRAFT', stage,
    description: null, clientId: null, clientFullName: null,
    latestEstimateTotal: null, estimateStatus: null, unreadQuestions: 0,
    completedAt: null, createdAt: '', updatedAt: '',
  };
}

describe('matches — the ONE filter rule (object-status-unification + archived toggle)', () => {
  it('ALL hides terminal (completed/cancelled) objects by default, shows live ones', () => {
    (['ASSESSMENT', 'PENDING_SIGNATURE', 'IN_PROGRESS'] as ObjectStage[])
      .forEach((stage) => expect(matches(project(stage), 'ALL', false)).toBe(true));
    expect(matches(project('COMPLETED'), 'ALL', false)).toBe(false);
    expect(matches(project('CANCELLED'), 'ALL', false)).toBe(false);
  });

  it('ALL includes terminal objects once archived is revealed', () => {
    expect(matches(project('COMPLETED'), 'ALL', true)).toBe(true);
    expect(matches(project('CANCELLED'), 'ALL', true)).toBe(true);
  });

  it('a specific filter matches only its own stage, regardless of the archived toggle', () => {
    expect(matches(project('PENDING_SIGNATURE'), 'PENDING_SIGNATURE', false)).toBe(true);
    expect(matches(project('IN_PROGRESS'), 'PENDING_SIGNATURE', false)).toBe(false);
    expect(matches(project('CANCELLED'), 'CANCELLED', false)).toBe(true);
  });

  it('reads the DERIVED stage, not the raw status or the estimate status — the exact bug fixed here', () => {
    // An object whose raw `status` says DRAFT but whose derived `stage` is IN_PROGRESS (e.g. it has
    // a SIGNED estimate) must match the IN_PROGRESS filter — this is what the card badge, the
    // filter chip, and the dashboard metric all now agree on.
    const p = { ...project('IN_PROGRESS'), status: 'DRAFT' as const };
    expect(matches(p, 'IN_PROGRESS', false)).toBe(true);
  });
});
