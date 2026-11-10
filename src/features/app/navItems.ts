/** The 4 primary surfaces (SPEC E: Головна · Обʼєкти · Каталог · Я), shared by the desktop sidebar
 *  and mobile bottom nav. `labelKey` is an i18n key resolved at render time. */
export interface NavItem {
  to: string;
  labelKey: string;
  icon: string;
  end: boolean;
  /** Other paths that belong to this place — the Catalog's «Шаблони» tab lives at `/templates`. */
  also?: readonly string[];
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav.home', icon: '🏠', end: true },
  { to: '/projects', labelKey: 'nav.projects', icon: '📁', end: false },
  { to: '/catalog', labelKey: 'nav.catalog', icon: '📖', end: false, also: ['/templates'] },
  { to: '/profile', labelKey: 'nav.profile', icon: '👤', end: false },
];

/** NavLink's own match, plus the item's `also` paths. */
export function navItemActive(item: NavItem, pathname: string, isActive: boolean): boolean {
  return isActive || (item.also ?? []).some((p) => pathname === p || pathname.startsWith(p + '/'));
}
