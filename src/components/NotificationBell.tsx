import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ActionMenu } from './ActionMenu.tsx';
import { useProjects } from '@/features/projects/useProjects.ts';
import { routes } from '@/lib/config.ts';

/**
 * Header bell with an unread-questions counter (Fix F in-app notifications).
 * The count + list come from the projects list (each ProjectResponse carries
 * unreadQuestions), so there's no extra request and no global questions
 * endpoint needed — tapping a row opens the project where the questions live.
 *
 * <p>It drops from the bell rather than opening a centred dialog, for the same reason a row's ⋮
 * does: an icon in a corner that answers in the middle of the screen makes the master re-find what
 * he pressed. Same {@link ActionMenu} the row menus use, so there is one behaviour to learn.</p>
 */
export function NotificationBell() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { data } = useProjects();

  const withUnread = (data ?? []).filter((p) => (p.unreadQuestions ?? 0) > 0);
  const total = withUnread.reduce((sum, p) => sum + (p.unreadQuestions ?? 0), 0);

  return (
    <ActionMenu
      ariaLabel={
        total > 0 ? t('notifications.ariaWithCount', { count: total }) : t('notifications.aria')
      }
      triggerClassName="relative flex h-9 w-9 items-center justify-center rounded-xl bg-surface-sunken text-lg text-primary"
      trigger={
        <>
          🔔
          {total > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">
              {total > 9 ? '9+' : total}
            </span>
          )}
        </>
      }
    >
      {(close) => (
        <>
          <p className="px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-muted">
            {t('notifications.title')}
          </p>
          {withUnread.length === 0 ? (
            <p className="px-4 pb-3 text-sm text-muted">{t('notifications.empty')}</p>
          ) : (
            // Capped and scrollable: an unbounded list would run past the bottom of the screen,
            // and the flip-up the panel does when it is too tall cannot help a list with no end.
            <div className="max-h-[60vh] overflow-y-auto">
              {withUnread.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { close(); void navigate(routes.project(p.id)); }}
                  className="flex min-h-[44px] w-full items-center gap-3 px-4 py-2 text-left active:bg-surface-sunken"
                >
                  <span className="text-lg">💬</span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm font-semibold leading-snug text-primary">
                      {p.name}
                    </span>
                    <span className="block text-xs text-muted">
                      {t('notifications.newQuestions', { count: p.unreadQuestions })}
                    </span>
                  </span>
                  <span className="text-muted">→</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </ActionMenu>
  );
}
