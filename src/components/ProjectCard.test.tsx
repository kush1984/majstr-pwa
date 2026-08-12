import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ProjectCard } from './ProjectCard.tsx';
import type { ObjectStage, ProjectResponse } from '@/api/types.ts';

vi.mock('@/api/messageLink.ts', () => ({
  messageLinkApi: { state: vi.fn(), revoke: vi.fn() },
}));
vi.mock('@/api/projects.ts', () => ({
  projectsApi: { setStatus: vi.fn() },
}));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

function project(overrides: Partial<ProjectResponse> = {}): ProjectResponse {
  return {
    id: 'p1', name: 'Хата', address: 'вул. 1', status: 'DRAFT', stage: 'ASSESSMENT',
    description: null, clientId: null, clientFullName: null,
    latestEstimateTotal: null, estimateStatus: null, unreadQuestions: 0,
    completedAt: null, createdAt: '', updatedAt: '',
    ...overrides,
  };
}

function renderCard(p: ProjectResponse) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><ProjectCard project={p} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProjectCard — the badge shows the ONE derived stage (object-status-unification)', () => {
  it('shows «Чернетка» for ASSESSMENT even with no estimate yet', () => {
    renderCard(project({ stage: 'ASSESSMENT', estimateStatus: null }));
    expect(screen.getByText('Чернетка')).toBeTruthy();
  });

  it('shows «В роботі» once there is a SIGNED estimate — not the estimate\'s own status label', () => {
    // The exact bug this replaces: an estimate-driven badge would have shown "Підписано" here
    // instead of the object-level stage.
    renderCard(project({ stage: 'IN_PROGRESS', estimateStatus: 'SIGNED', latestEstimateTotal: 1000 }));
    expect(screen.getByText('В роботі')).toBeTruthy();
    expect(screen.queryByText('Підписано')).toBeNull();
  });

  it('shows «Очікує» for PENDING_SIGNATURE (a SENT estimate, none signed)', () => {
    renderCard(project({ stage: 'PENDING_SIGNATURE', estimateStatus: 'SENT' }));
    expect(screen.getByText('Очікує')).toBeTruthy();
  });

  it('shows «Скасовано» for a CANCELLED object regardless of its estimate status', () => {
    renderCard(project({ stage: 'CANCELLED', estimateStatus: 'SIGNED' }));
    expect(screen.getByText('Скасовано')).toBeTruthy();
  });

  const stages: ObjectStage[] = ['ASSESSMENT', 'PENDING_SIGNATURE', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
  it.each(stages)('renders a badge for every stage (%s) without crashing', (stage) => {
    renderCard(project({ stage }));
    expect(screen.getByText('Хата')).toBeTruthy();
  });
});
