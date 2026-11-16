import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { routes } from '@/lib/config.ts';
import { useInboxCount } from './useInbox.ts';

/**
 * «Вхідні» on the home screen (majster-bot) — one row, like the money strip. With something
 * waiting it says how much; otherwise it is the door to a quick note.
 */
export function InboxHomeStrip() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const count = useInboxCount();
  const open = count.data ?? 0;

  return (
    <button
      type="button"
      onClick={() => navigate(routes.inbox)}
      className="mb-3 flex min-h-11 w-full items-center gap-3 rounded-card border border-border bg-surface px-3.5 py-2.5 text-left"
    >
      <span className="text-base leading-none" aria-hidden>📥</span>
      <span className="truncate text-sm font-semibold text-primary">
        {open > 0 ? t('inbox.homeWaiting') : t('inbox.homeQuick')}
      </span>
      {open > 0 && (
        <span className="ml-auto flex-shrink-0 rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-white">{open}</span>
      )}
      <span className={`flex-shrink-0 text-muted ${open > 0 ? '' : 'ml-auto'}`} aria-hidden>›</span>
    </button>
  );
}
