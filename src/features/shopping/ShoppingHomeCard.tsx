import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { routes } from '@/lib/config.ts';
import { useShoppingSummary } from './useShoppingList.ts';

/**
 * The home screen's «🛒 Купити» card — the objects with something still to buy.
 *
 * It renders nothing at all when there is nothing to buy: the server already drops archived lists
 * and lists whose every row is ticked, so an empty answer is the normal state for most masters and
 * an empty card would just be furniture. The counts come from the same summary the list screen
 * writes back to, so ticking a row offline updates this card too.
 */
export function ShoppingHomeCard() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const summary = useShoppingSummary();

  const lists = summary.data ?? [];
  if (lists.length === 0) return null;

  return (
    <div className="mb-6 overflow-hidden rounded-card border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span aria-hidden>🛒</span>
        <h2 className="text-[13px] font-bold uppercase tracking-wide text-primary">
          {t('shopping.homeTitle')}
        </h2>
      </div>
      {lists.map((l) => (
        <button
          key={l.projectId}
          type="button"
          onClick={() => navigate(routes.shopping(l.projectId), { state: { from: routes.home } })}
          className="flex min-h-[56px] w-full items-center gap-3 border-b border-border px-4 text-left last:border-b-0"
        >
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary">
            {l.projectName}
          </span>
          <span className="flex-shrink-0 text-xs text-muted">
            {t('shopping.homeLeft', { count: l.totalCount - l.boughtCount })}
          </span>
          <span className="flex-shrink-0 text-muted" aria-hidden>›</span>
        </button>
      ))}
    </div>
  );
}
