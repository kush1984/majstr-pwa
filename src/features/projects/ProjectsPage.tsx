import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Chip } from '@/components/Chip.tsx';
import { Button } from '@/components/Button.tsx';
import { Skeleton } from '@/components/Skeleton.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { ProjectCard } from '@/components/ProjectCard.tsx';
import { routes } from '@/lib/config.ts';
import type { ProjectStatus } from '@/api/types.ts';
import { useProjects } from './useProjects.ts';

type Filter = 'ALL' | Extract<ProjectStatus, 'IN_PROGRESS' | 'COMPLETED'>;

export function ProjectsPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('ALL');
  // Fetch all once and filter client-side so the chips can show live counts.
  const { data, isPending, isError, refetch } = useProjects();

  const all = useMemo(() => data ?? [], [data]);
  const counts = useMemo(
    () => ({
      ALL: all.length,
      IN_PROGRESS: all.filter((p) => p.status === 'IN_PROGRESS').length,
      COMPLETED: all.filter((p) => p.status === 'COMPLETED').length,
    }),
    [all],
  );
  const shown = filter === 'ALL' ? all : all.filter((p) => p.status === filter);

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
        <Chip active={filter === 'ALL'} onClick={() => setFilter('ALL')}>
          Усі · {counts.ALL}
        </Chip>
        <Chip active={filter === 'IN_PROGRESS'} onClick={() => setFilter('IN_PROGRESS')}>
          В роботі · {counts.IN_PROGRESS}
        </Chip>
        <Chip active={filter === 'COMPLETED'} onClick={() => setFilter('COMPLETED')}>
          Завершені · {counts.COMPLETED}
        </Chip>
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
