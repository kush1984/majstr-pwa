import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Modal } from './Modal.tsx';
import { useProjects } from '@/features/projects/useProjects.ts';
import { routes } from '@/lib/config.ts';

/**
 * Header bell with an unread-questions counter (Fix F in-app notifications).
 * The count + list come from the projects list (each ProjectResponse carries
 * unreadQuestions), so there's no extra request and no global questions
 * endpoint needed — tapping a row opens the project where the questions live.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { data } = useProjects();

  const withUnread = (data ?? []).filter((p) => (p.unreadQuestions ?? 0) > 0);
  const total = withUnread.reduce((sum, p) => sum + (p.unreadQuestions ?? 0), 0);

  const go = (id: string) => {
    setOpen(false);
    navigate(routes.project(id));
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={
          total > 0 ? t('notifications.ariaWithCount', { count: total }) : t('notifications.aria')
        }
        className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-surface-sunken text-lg text-primary"
      >
        🔔
        {total > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">
            {total > 9 ? '9+' : total}
          </span>
        )}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={t('notifications.title')}>
        {withUnread.length === 0 ? (
          <div className="py-6 text-center">
            <div className="mb-1 text-2xl">🔔</div>
            <p className="text-sm text-muted">{t('notifications.empty')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {withUnread.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => go(p.id)}
                className="flex w-full items-center gap-3 rounded-card border border-border bg-surface p-3 text-left transition-transform active:scale-[0.99]"
              >
                <span className="text-lg">💬</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-primary">{p.name}</span>
                  <span className="block text-xs text-muted">
                    {t('notifications.newQuestions', { count: p.unreadQuestions })}
                  </span>
                </span>
                <span className="text-muted">→</span>
              </button>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}
