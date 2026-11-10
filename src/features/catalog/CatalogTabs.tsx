import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { routes } from '@/lib/config.ts';
import { cn } from '@/lib/cn.ts';

/**
 * «Позиції | Шаблони» at the top of the Catalog — the templates moved here from the bottom bar, which
 * keeps the four places SPEC E names (Головна · Обʼєкти · Каталог · Я). Two routes, not one page with
 * state: `/templates` stays a real address (links, `_redirects`, an installed app's history).
 */
export function CatalogTabs() {
  const { t } = useTranslation();
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex min-h-[40px] flex-1 items-center justify-center rounded-lg text-sm font-semibold transition-colors',
      isActive ? 'bg-surface text-primary shadow-sm' : 'text-muted',
    );
  return (
    <nav aria-label={t('catalog.tabsLabel')} className="ph-unmask mb-4 flex gap-1 rounded-xl bg-surface-sunken p-1">
      <NavLink to={routes.catalog} end className={tab}>{t('catalog.tabItems')}</NavLink>
      <NavLink to={routes.templates} className={tab}>{t('catalog.tabTemplates')}</NavLink>
    </nav>
  );
}
