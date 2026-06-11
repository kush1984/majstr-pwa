import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMe } from '@/features/auth/useMe.ts';
import { useProjects } from '@/features/projects/useProjects.ts';
import { useDashboardMetrics } from './useDashboardMetrics.ts';
import { MetricCard } from '@/components/MetricCard.tsx';
import { ProjectCard } from '@/components/ProjectCard.tsx';
import { Skeleton } from '@/components/Skeleton.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { ErrorState } from '@/components/ErrorState.tsx';
import { Button } from '@/components/Button.tsx';
import { formatMoney } from '@/lib/format.ts';
import { TRADE_EMOJI } from '@/lib/labels.ts';
import { routes } from '@/lib/config.ts';

export function DashboardPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { data: me } = useMe();

  const greeting = (): string => {
    const h = new Date().getHours();
    if (h < 12) return t('dashboard.greetingMorning');
    if (h < 18) return t('dashboard.greetingDay');
    return t('dashboard.greetingEvening');
  };
  const metrics = useDashboardMetrics();
  const projects = useProjects();

  const firstName = me?.fullName?.trim().split(/\s+/)[0] ?? '';
  const trades = me?.trades ?? [];
  const recent = (projects.data ?? []).slice(0, 4);
  const m = metrics.data;

  const newEstimate = () => navigate(routes.newEstimate);

  const isEmpty = projects.isSuccess && projects.data.length === 0;

  // Full outage (both dashboard queries failed) → one page-level error with a
  // single retry instead of two stacked error blocks.
  if (metrics.isError && projects.isError) {
    return (
      <ErrorState
        error={projects.error}
        onRetry={() => {
          void metrics.refetch();
          void projects.refetch();
        }}
      />
    );
  }

  return (
      <>
        {/* Greeting + desktop CTA */}
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <div className="text-sm text-muted">{greeting()},</div>
            <h1 className="mt-0.5 flex items-center gap-2 text-2xl font-extrabold tracking-tight text-primary">
              {firstName || '...'}
              {trades.length > 0 && (
                  <span className="flex flex-wrap items-center gap-2">
                  {trades.map((trade) => (
                      <span
                          key={trade}
                          className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand"
                          title={t('trades.' + trade)}
                          aria-label={t('trades.' + trade)}
                      >
        {TRADE_EMOJI[trade]} {t('trades.' + trade)}
      </span>
    ))}
  </span>
            )}
          </h1>
        </div>
        <Button onClick={newEstimate} className="hidden lg:inline-flex">
          {t('common.addEstimate')}
        </Button>
      </div>

      {/* Metrics: 2 on mobile, 3 on desktop. An error shows an honest compact
          strip — silently rendering "0 активних" during an outage would lie. */}
      {metrics.isError ? (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-card border border-border bg-surface p-4">
          <p className="text-sm text-muted">⚠️ {t('dashboard.metricsError')}</p>
          <Button variant="secondary" onClick={() => void metrics.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : (
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
              label={t('dashboard.metricActive')}
              value={m?.activeProjects ?? 0}
              hint={t('dashboard.metricActiveHint')}
              icon="📁"
              tone="brand"
              onClick={() => navigate(`${routes.projects}?status=IN_PROGRESS`)}
            />
            <MetricCard
              label={t('dashboard.metricPending')}
              value={m?.pendingEstimates ?? 0}
              hint={t('dashboard.metricPendingHint')}
              icon="⏳"
              tone="amber"
              onClick={() => navigate(`${routes.projects}?status=SENT`)}
            />
            <MetricCard
              className="hidden lg:block"
              label={t('dashboard.metricCompleted')}
              value={m?.completedThisMonth.count ?? 0}
              hint={t('dashboard.metricCompletedHint', {
                amount: formatMoney(m?.completedThisMonth.totalAmount),
              })}
              icon="✓"
              tone="green"
              onClick={() => navigate(`${routes.projects}?status=COMPLETED`)}
            />
          </>
        )}
      </div>
      )}

      {/* Mobile CTA */}
      <Button onClick={newEstimate} fullWidth className="mb-6 py-4 text-base shadow-cta lg:hidden">
        {t('common.addEstimate')}
      </Button>

      {isEmpty ? (
        <EmptyState
          icon="📋"
          title={t('dashboard.createFirstTitle')}
          text={t('dashboard.createFirstText')}
          action={<Button onClick={newEstimate}>{t('dashboard.createFirstAction')}</Button>}
        />
      ) : (
        <div className="lg:grid lg:grid-cols-[1.6fr_1fr] lg:items-start lg:gap-5">
          <section className="lg:rounded-card lg:border lg:border-border lg:bg-surface lg:p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-bold uppercase tracking-wide text-primary lg:text-[15px] lg:normal-case lg:tracking-normal">
                {t('dashboard.recentProjects')}
              </h2>
              <button
                type="button"
                onClick={() => navigate(routes.projects)}
                className="text-[13px] font-semibold text-brand"
              >
                {t('common.all')} →
              </button>
            </div>

            {projects.isPending ? (
              <div className="space-y-2.5">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-[68px] rounded-card" />
                ))}
              </div>
            ) : projects.isError ? (
              <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />
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
            <h2 className="mb-4 text-[15px] font-bold text-primary">{t('dashboard.quickActions')}</h2>
            <div className="flex flex-col gap-2.5">
              <QuickAction
                icon="📋"
                title={t('dashboard.quickNewEstimate')}
                sub={t('dashboard.quickNewEstimateSub')}
                onClick={newEstimate}
              />
              <QuickAction
                icon="📖"
                title={t('dashboard.quickAddCatalog')}
                sub={t('dashboard.quickAddCatalogSub')}
                onClick={() => navigate(routes.catalog)}
              />
              <QuickAction
                icon="📁"
                title={t('dashboard.quickAllProjects')}
                sub={t('dashboard.quickAllProjectsSub')}
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
