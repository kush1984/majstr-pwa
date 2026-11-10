import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/lib/i18n.ts';
import { DashboardPage } from './DashboardPage.tsx';
import { useProjects } from '@/features/projects/useProjects.ts';
import type { ProjectResponse } from '@/api/types.ts';

vi.mock('@/features/auth/useMe.ts', () => ({ useMe: () => ({ data: undefined }) }));
vi.mock('@/features/projects/useProjects.ts', () => ({ useProjects: vi.fn(), isTerminalStage: () => false }));
vi.mock('./useDashboardMetrics.ts', () => ({
  useDashboardMetrics: () => ({
    isPending: false, isError: false,
    data: { activeProjects: 0, pendingObjects: 0, completedThisMonth: { count: 0, totalAmount: 0 } },
  }),
}));
vi.mock('@/features/plan/usePlanLimits.ts', () => ({ usePlanLimits: () => ({ data: undefined }), isAtLimit: () => false }));
vi.mock('@/features/shopping/ShoppingHomeCard.tsx', () => ({ ShoppingHomeCard: () => null }));
vi.mock('@/features/cash/CashHomeStrip.tsx', () => ({ CashHomeStrip: () => null }));
vi.mock('./HelpOfferCard.tsx', () => ({ HelpOfferCard: () => null }));
vi.mock('./VerifiedTrialCard.tsx', () => ({ VerifiedTrialCard: () => null }));
vi.mock('@/components/ProjectCard.tsx', () => ({ ProjectCard: () => null }));
const openSample = vi.fn();
vi.mock('@/features/projects/useSampleProject.ts', () => ({
  useSampleProject: () => ({ open: openSample, creating: false, online: true, offlineTitle: undefined }),
}));

function renderWith(projects: ProjectResponse[]) {
  vi.mocked(useProjects).mockReturnValue(
    { isSuccess: true, isPending: false, isError: false, data: projects } as unknown as ReturnType<typeof useProjects>);
  return render(<MemoryRouter><DashboardPage /></MemoryRouter>);
}

describe('DashboardPage — the first screen', () => {
  it('shows no metrics before the first object, and says only a name is needed', () => {
    renderWith([]);

    expect(screen.queryByText('Активних')).toBeNull();
    expect(screen.queryByText('Очікує')).toBeNull();
    expect(screen.getByText('Почніть з назви — адресу й клієнта можна додати потім.')).toBeTruthy();
  });

  it('offers «Подивитися приклад» beside the first object, outside the limit', () => {
    renderWith([]);

    fireEvent.click(screen.getByRole('button', { name: 'Подивитися приклад' }));

    expect(openSample).toHaveBeenCalledOnce();
    expect(screen.getByText(/Не рахується в ліміт обʼєктів/)).toBeTruthy();
  });

  it('keeps them hidden while the only object is the training sample — no figure reads it', () => {
    renderWith([{ id: 's1', name: 'Приклад: ванна 4 м²', stage: 'ASSESSMENT', sample: true } as unknown as ProjectResponse]);

    expect(screen.queryByText('Активних')).toBeNull();
  });

  it('brings the metrics back once there is an object', () => {
    renderWith([{ id: 'p1', name: 'Ванна', stage: 'ASSESSMENT' } as unknown as ProjectResponse]);

    expect(screen.getByText('Активних')).toBeTruthy();
    expect(screen.getByText('Очікує')).toBeTruthy();
  });
});
