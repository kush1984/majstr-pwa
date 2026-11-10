import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { useSampleProject } from './useSampleProject.ts';
import { projectsApi } from '@/api/projects.ts';
import { toast } from '@/hooks/useToast.ts';
import type { ProjectResponse } from '@/api/types.ts';

vi.mock('@/api/projects.ts', () => ({ projectsApi: { createSample: vi.fn() } }));
vi.mock('@/hooks/useToast.ts', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));
const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  onlineManager.setOnline(true);
});

describe('useSampleProject', () => {
  it('asks the server for the sample of the trade just picked, after the answer is saved, and opens it', async () => {
    const order: string[] = [];
    vi.mocked(projectsApi.createSample).mockImplementation(async () => {
      order.push('create');
      return { id: 's1', sample: true } as ProjectResponse;
    });
    const { result } = renderHook(() => useSampleProject(), { wrapper });

    await act(async () => {
      result.current.open('TILING', async () => { order.push('save'); });
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(order).toEqual(['save', 'create']);
    expect(projectsApi.createSample).toHaveBeenCalledWith('TILING');
    expect(navigate).toHaveBeenCalledWith('/projects/s1', { replace: true });
  });

  it('one already alive (another phone made it): says so and opens the list, no red error', async () => {
    vi.mocked(projectsApi.createSample).mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { status: 409, code: 'SAMPLE_PROJECT_EXISTS', message: 'є' } },
    });
    const { result } = renderHook(() => useSampleProject(), { wrapper });

    await act(async () => {
      result.current.open();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(toast.info).toHaveBeenCalledWith('Приклад уже є — він у списку обʼєктів');
    expect(toast.error).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/projects', { replace: true });
  });

  it('offline it explains that a connection is needed and asks the server nothing', async () => {
    onlineManager.setOnline(false);
    const { result } = renderHook(() => useSampleProject(), { wrapper });

    await act(async () => { result.current.open(); });

    expect(result.current.online).toBe(false);
    expect(projectsApi.createSample).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });
});
