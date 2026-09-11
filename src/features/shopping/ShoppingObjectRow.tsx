import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { routes } from '@/lib/config.ts';
import { useShoppingList } from './useShoppingList.ts';

/**
 * The way into «Список покупок» from the object screen — one row under the hero, above the tabs.
 *
 * Deliberately NOT a sixth tab: the list is not something the master reads on the object screen,
 * it is something he opens in a shop and works through full-screen. It is shown even when the list
 * is empty, so «додати вручну» has a door before the calculator has ever run.
 */
export function ShoppingObjectRow({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const list = useShoppingList(projectId);

  const total = list.data?.totalCount ?? 0;
  const left = total - (list.data?.boughtCount ?? 0);

  return (
    <button
      type="button"
      onClick={() =>
        navigate(routes.shopping(projectId), { state: { from: routes.project(projectId) } })
      }
      className="mb-4 flex min-h-[56px] w-full items-center gap-3 rounded-card border border-border bg-surface px-4 text-left"
    >
      <span aria-hidden>🛒</span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary">
        {t('shopping.title')}
      </span>
      <span className="flex-shrink-0 text-xs text-muted">
        {total === 0 ? t('shopping.rowEmpty') : t('shopping.homeLeft', { count: left })}
      </span>
      <span className="flex-shrink-0 text-muted" aria-hidden>›</span>
    </button>
  );
}
