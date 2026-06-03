import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Chip } from '@/components/Chip.tsx';
import { Button } from '@/components/Button.tsx';
import { Skeleton } from '@/components/Skeleton.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { ProjectCard } from '@/components/ProjectCard.tsx';
import { routes } from '@/lib/config.ts';
import type { ProjectResponse } from '@/api/types.ts';
import { useProjects } from './useProjects.ts';

/**
 * Filter is URL-driven (`?status=`) so the dashboard metric cards can deep-link
 * straight into a filtered list. SENT filters by the latest estimate's status
 * (awaiting signature); the others by the project's own status.
 */
type Filter = 'ALL' | 'IN_PROGRESS' | 'SENT' | 'COMPLETED';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'ALL', label: 'Усі' },
  { value: 'IN_PROGRESS', label: 'В роботі' },
  { value: 'SENT', label: 'Очікує' },
  { value: 'COMPLETED', label: 'Завершені' },
];

function matches(p: ProjectResponse, f: Filter): boolean {
  if (f === 'ALL') return true;
  if (f === 'SENT') return p.estimateStatus === 'SENT';
  return p.status === f;
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const raw = params.get('status');
  const filter: Filter =
    raw === 'IN_PROGRESS' || raw === 'SENT' || raw === 'COMPLETED' ? raw : 'ALL';

  // Fetch all once and filter client-side so the chips can show live counts.
  const { data, isPending, isError, refetch } = useProjects();
  const all = useMemo(() => data ?? [], [data]);

  const counts = useMemo<Record<Filter, number>>(
    () => ({
      ALL: all.length,
      IN_PROGRESS: all.filter((p) => p.status === 'IN_PROGRESS').length,
      SENT: all.filter((p) => p.estimateStatus === 'SENT').length,
      COMPLETED: all.filter((p) => p.status === 'COMPLETED').length,
    }),
    [all],
  );
  const shown = useMemo(() => all.filter((p) => matches(p, filter)), [all, filter]);

  const setFilter = (f: Filter) =>
    setParams(f === 'ALL' ? {} : { status: f }, { replace: true });
  const newEstimate = () => navigate(routes.newEstimate);

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight text-primary sm:text-[26px]">
          Об'єкти
        </h1>
        <Button onClick={newEstimate} className="hidden sm:inline-flex">
          + Новий кошторис
        </Button>
      </div>

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <Chip key={f.value} active={filter === f.value} onClick={() => setFilter(f.value)}>
            {f.label} · {counts[f.value]}
          </Chip>
        ))}
      </div>

      {isPending ? (
        <div className="space-y-2.5">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[68px] rounded-card" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          icon="⚠️"
          title="Не вдалося завантажити об'єкти"
          text="Перевірте з'єднання та спробуйте ще раз."
          action={<Button onClick={() => void refetch()}>Спробувати знову</Button>}
        />
      ) : all.length === 0 ? (
        <EmptyState
          icon="📁"
          title="Ще немає об'єктів"
          text="Створіть перший кошторис — об'єкт і клієнт додаються прямо в потоці."
          action={<Button onClick={newEstimate}>Новий кошторис</Button>}
        />
      ) : shown.length === 0 ? (
        <EmptyState icon="🔍" title="Нічого не знайдено" text="У цьому фільтрі поки порожньо." />
      ) : (
        <>
          <div className="space-y-2.5">
            {shown.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
          <Button onClick={newEstimate} fullWidth className="mt-5 py-3.5 shadow-cta sm:hidden">
            + Новий кошторис
          </Button>
        </>
      )}
    </>
  );
}
