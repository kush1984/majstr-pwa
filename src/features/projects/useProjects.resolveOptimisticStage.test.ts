import { describe, it, expect } from 'vitest';
import { resolveOptimisticStage } from './useProjects.ts';
import type { ProjectResponse } from '@/api/types.ts';

function project(estimateStatus: ProjectResponse['estimateStatus']): ProjectResponse {
  return {
    id: 'p1', name: 'Хата', address: 'вул. 1', status: 'IN_PROGRESS', stage: 'IN_PROGRESS',
    description: null, clientId: null, clientFullName: null,
    latestEstimateTotal: null, estimateStatus, unreadQuestions: 0,
    completedAt: null, createdAt: '', updatedAt: '',
  };
}

describe('resolveOptimisticStage — best-effort stage for the manual complete/reopen/cancel/restore actions', () => {
  it('CANCELLED is always exactly right — top priority regardless of estimates', () => {
    expect(resolveOptimisticStage(project('SIGNED'), 'CANCELLED')).toBe('CANCELLED');
  });

  it('COMPLETED is always exactly right too', () => {
    expect(resolveOptimisticStage(project(null), 'COMPLETED')).toBe('COMPLETED');
  });

  it('reopen/restore (both send IN_PROGRESS) guess IN_PROGRESS when the latest estimate is SIGNED', () => {
    expect(resolveOptimisticStage(project('SIGNED'), 'IN_PROGRESS')).toBe('IN_PROGRESS');
  });

  it('guesses PENDING_SIGNATURE when the latest estimate is SENT', () => {
    expect(resolveOptimisticStage(project('SENT'), 'IN_PROGRESS')).toBe('PENDING_SIGNATURE');
  });

  it('falls back to ASSESSMENT when there is no estimate to go on', () => {
    expect(resolveOptimisticStage(project(null), 'IN_PROGRESS')).toBe('ASSESSMENT');
  });
});
