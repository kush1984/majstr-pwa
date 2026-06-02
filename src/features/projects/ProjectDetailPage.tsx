import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/Badge.tsx';
import { Button } from '@/components/Button.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { IconTile } from '@/components/IconTile.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { EmailVerifyModal } from '@/features/email/EmailVerifyModal.tsx';
import { estimatesApi } from '@/api/estimates.ts';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { formatMoney, initials } from '@/lib/format.ts';
import { ESTIMATE_STATUS, PROJECT_STATUS } from '@/lib/labels.ts';
import { routes } from '@/lib/config.ts';
import type { EstimateSummary } from '@/api/types.ts';
import { useProject } from './useProjects.ts';
import { useEstimate } from '@/features/estimate/useEstimate.ts';

type Tab = 'estimate' | 'photos' | 'changes' | 'act';
const TABS: { key: Tab; label: string }[] = [
  { key: 'estimate', label: 'Кошторис' },
  { key: 'photos', label: 'Фото' },
  { key: 'changes', label: 'Зміни' },
  { key: 'act', label: 'Акт' },
];

export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const project = useProject(id);
  const [tab, setTab] = useState<Tab>('estimate');
  const [sharing, setSharing] = useState(false);
  const [emailGateOpen, setEmailGateOpen] = useState(false);

  const estimates = useQuery({
    queryKey: ['project-estimates', id],
    queryFn: () => estimatesApi.listForProject(id),
    enabled: Boolean(id),
  });

  const createEstimate = useMutation({
    mutationFn: () => estimatesApi.createForProject(id, {}),
    onSuccess: (e) => {
      qc.invalidateQueries({ queryKey: ['project-estimates', id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      navigate(routes.estimate(e.id));
    },
    onError: (err) => toast.error(toAppError(err).message),
  });

  if (project.isPending) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center text-brand">
        <Spinner size="lg" />
      </div>
    );
  }
  if (project.isError || !project.data) {
    return (
      <EmptyState
        icon="⚠️"
        title="Об'єкт не знайдено"
        action={<Button onClick={() => navigate(routes.projects)}>До списку</Button>}
      />
    );
  }

  const p = project.data;
  const list = estimates.data ?? [];
  const status = PROJECT_STATUS[p.status];

  const shareLatest = async () => {
    const latest = list[0];
    if (!latest) {
      toast.info('Спершу створіть кошторис');
      return;
    }
    setSharing(true);
    try {
      const link = await estimatesApi.createShareLink(latest.id);
      await navigator.clipboard?.writeText(link.url).catch(() => undefined);
      toast.success('Посилання скопійовано');
    } catch (err) {
      const e = toAppError(err);
      if (e.code === 'EMAIL_NOT_VERIFIED') {
        setEmailGateOpen(true);
      } else {
        toast.error(e.status === 403 ? 'Портал для клієнта доступний у плані PRO' : e.message);
      }
    } finally {
      setSharing(false);
    }
  };

  return (
    <>
      <EmailVerifyModal open={emailGateOpen} onClose={() => setEmailGateOpen(false)} />

      <div className="mb-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(routes.projects)}
          aria-label="Назад"
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-sunken text-lg text-primary"
        >
          ←
        </button>
        <span className="text-sm text-muted">Об'єкт</span>
      </div>

      {/* Hero */}
      <div className="mb-4 rounded-card border border-border bg-surface-sunken p-4">
        <div className="mb-1.5 flex items-center gap-2 text-[17px] font-bold text-primary">
          <IconTile tone="brand" size={32}>
            📁
          </IconTile>
          <span className="min-w-0 truncate">{p.name}</span>
        </div>
        <div className="mb-3 text-xs text-muted">📍 {p.address}</div>
        <Badge variant={status.variant}>{status.label}</Badge>
        {p.clientFullName && (
          <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-soft text-[11px] font-bold text-brand">
              {initials(p.clientFullName)}
            </span>
            <span className="text-xs text-primary">
              <strong className="font-semibold">{p.clientFullName}</strong>
            </span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1.5 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={
              'flex-1 border-b-2 py-2.5 text-center text-[13px] font-semibold transition-colors ' +
              (tab === t.key
                ? 'border-brand text-brand'
                : 'border-transparent text-muted')
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab !== 'estimate' ? (
        <EmptyState icon="🚧" title="Скоро" text="Цей розділ зʼявиться в наступних оновленнях." />
      ) : (
        <>
          <button
            type="button"
            onClick={shareLatest}
            disabled={sharing}
            className="mb-4 flex w-full items-center gap-3 rounded-card bg-brand p-3.5 text-left text-white shadow-cta disabled:opacity-70"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-white/20 text-lg">
              📤
            </span>
            <span className="flex-1">
              <span className="block text-sm font-bold">Поділитися з клієнтом</span>
              <span className="block text-[11px] opacity-85">Посилання на портал</span>
            </span>
            <span className="text-lg">→</span>
          </button>

          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-bold uppercase tracking-wide text-primary">
              Кошториси · {list.length}
            </h2>
            <button
              type="button"
              onClick={() => createEstimate.mutate()}
              disabled={createEstimate.isPending}
              className="text-[13px] font-semibold text-brand disabled:opacity-60"
            >
              + Новий
            </button>
          </div>

          {estimates.isPending ? (
            <p className="py-6 text-center text-sm text-muted">Завантаження...</p>
          ) : list.length === 0 ? (
            <EmptyState
              icon="🧾"
              title="Ще немає кошторисів"
              text="Створіть перший кошторис для цього об'єкта."
              action={
                <Button onClick={() => createEstimate.mutate()} loading={createEstimate.isPending}>
                  Новий кошторис
                </Button>
              }
            />
          ) : (
            <div className="space-y-2">
              {list.map((s) => (
                <EstimateRow
                  key={s.id}
                  summary={s}
                  onClick={() => navigate(routes.estimate(s.id))}
                />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

/** Loads the full estimate to show the backend-computed total + item count. */
function EstimateRow({ summary, onClick }: { summary: EstimateSummary; onClick: () => void }) {
  const full = useEstimate(summary.id);
  const status = ESTIMATE_STATUS[summary.status];
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-card border border-border bg-surface px-3.5 py-3 text-left transition-transform active:scale-[0.99]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-primary">Кошторис</span>
        <span className="whitespace-nowrap text-sm font-bold text-primary">
          {full.data ? formatMoney(full.data.total) : '—'}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <Badge variant={status.variant}>{status.label}</Badge>
        <span className="ml-auto text-xs text-muted">
          {full.data ? `${full.data.items.length} позицій` : '…'}
        </span>
      </div>
    </button>
  );
}
