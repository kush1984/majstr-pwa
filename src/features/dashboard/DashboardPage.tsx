import { useNavigate } from 'react-router-dom';
import { useMe } from '@/features/auth/useMe.ts';
import { useProjects } from '@/features/projects/useProjects.ts';
import { useDashboardMetrics } from './useDashboardMetrics.ts';
import { MetricCard } from '@/components/MetricCard.tsx';
import { ProjectCard } from '@/components/ProjectCard.tsx';
import { Skeleton } from '@/components/Skeleton.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { Button } from '@/components/Button.tsx';
import { formatMoney } from '@/lib/format.ts';
import { TRADE_EMOJI, TRADE_LABEL } from '@/lib/labels.ts';
import { routes } from '@/lib/config.ts';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Доброго ранку';
  if (h < 18) return 'Доброго дня';
  return 'Доброго вечора';
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const metrics = useDashboardMetrics();
  const projects = useProjects();

  const firstName = me?.fullName?.trim().split(/\s+/)[0] ?? '';
  const firstTrade = me?.trades?.[0];
  const recent = (projects.data ?? []).slice(0, 4);
  const m = metrics.data;

  const newEstimate = () => navigate(routes.newEstimate);

  const isEmpty = projects.isSuccess && projects.data.length === 0;

  return (
    <>
      {/* Greeting + desktop CTA */}
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-muted">{greeting()},</div>
          <h1 className="mt-0.5 flex items-center gap-2 text-2xl font-extrabold tracking-tight text-primary">
            {firstName || '...'}
            {firstTrade && (
              <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand">
                {TRADE_EMOJI[firstTrade]} {TRADE_LABEL[firstTrade]}
              </span>
            )}
          </h1>
        </div>
        <Button onClick={newEstimate} className="hidden lg:inline-flex">
          + Новий кошторис
        </Button>
      </div>

      {/* Metrics: 2 on mobile, 3 on desktop */}
      <div className="mb-5 grid grid-cols-2 gap-2.5 lg:grid-cols-3 lg:gap-4">
        {metrics.isPending ? (
          <>
            <Skeleton className="h-[104px] rounded-card" />
            <Skeleton className="h-[104px] rounded-card" />
            <Skeleton className="hidden h-[104px] rounded-card lg:block" />
          </>
        ) : (
          <>
            <MetricCard
              label="Активних"
              value={m?.activeProjects ?? 0}
              hint="об'єкти в роботі"
              icon="📁"
              tone="brand"
              onClick={() => navigate(routes.projects)}
            />
            <MetricCard
              label="Очікує"
              value={m?.pendingEstimates ?? 0}
              hint="кошториси без підпису"
              icon="⏳"
              tone="amber"
              onClick={() => navigate(routes.projects)}
            />
            <MetricCard
              className="hidden lg:block"
              label="Завершено (міс)"
              value={m?.completedThisMonth.count ?? 0}
              hint={`на суму ${formatMoney(m?.completedThisMonth.totalAmount)}`}
              icon="✓"
              tone="green"
              onClick={() => navigate(routes.projects)}
            />
          </>
        )}
      </div>

      {/* Mobile CTA */}
      <Button onClick={newEstimate} fullWidth className="mb-6 py-4 text-base shadow-cta lg:hidden">
        + Новий кошторис
      </Button>

      {isEmpty ? (
        <EmptyState
          icon="📋"
          title="Створіть перший кошторис"
          text="Додайте об'єкт, клієнта і позиції — за кілька хвилин матимете готовий кошторис для клієнта."
          action={<Button onClick={newEstimate}>Створити перший кошторис</Button>}
        />
      ) : (
        <div className="lg:grid lg:grid-cols-[1.6fr_1fr] lg:items-start lg:gap-5">
          <section className="lg:rounded-card lg:border lg:border-border lg:bg-surface lg:p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-bold uppercase tracking-wide text-primary lg:text-[15px] lg:normal-case lg:tracking-normal">
                Останні об'єкти
              </h2>
              <button
                type="button"
                onClick={() => navigate(routes.projects)}
                className="text-[13px] font-semibold text-brand"
              >
                Усі →
              </button>
            </div>

            {projects.isPending ? (
              <div className="space-y-2.5">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-[68px] rounded-card" />
                ))}
              </div>
            ) : (
              <div className="space-y-2.5">
                {recent.map((p) => (
                  <ProjectCard key={p.id} project={p} />
                ))}
              </div>
            )}
          </section>

          {/* Desktop-only quick actions */}
          <aside className="hidden lg:block lg:rounded-card lg:border lg:border-border lg:bg-surface lg:p-5">
            <h2 className="mb-4 text-[15px] font-bold text-primary">Швидкі дії</h2>
            <div className="flex flex-col gap-2.5">
              <QuickAction icon="📋" title="Новий кошторис" sub="Для нового клієнта" onClick={newEstimate} />
              <QuickAction
                icon="📖"
                title="Додати в каталог"
                sub="Робота чи матеріал"
                onClick={() => navigate(routes.catalog)}
              />
              <QuickAction
                icon="📁"
                title="Усі об'єкти"
                sub="Переглянути список"
                onClick={() => navigate(routes.projects)}
              />
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

function QuickAction({
  icon,
  title,
  sub,
  onClick,
}: {
  icon: string;
  title: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-xl bg-surface-sunken p-3 text-left transition-colors hover:bg-border"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-border bg-surface text-base">
        {icon}
      </span>
      <span>
        <span className="block text-[13px] font-semibold text-primary">{title}</span>
        <span className="block text-[11px] text-muted">{sub}</span>
      </span>
    </button>
  );
}
