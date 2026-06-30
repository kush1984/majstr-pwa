/** The 4 primary surfaces, shared by the desktop sidebar and mobile bottom nav.
 *  `labelKey` is an i18n key resolved at render time. */
export interface NavItem {
  to: string;
  labelKey: string;
  icon: string;
  end: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav.home', icon: '🏠', end: true },
  { to: '/projects', labelKey: 'nav.projects', icon: '📁', end: false },
  { to: '/catalog', labelKey: 'nav.catalog', icon: '📖', end: false },
  { to: '/templates', labelKey: 'nav.templates', icon: '📋', end: false },
  { to: '/profile', labelKey: 'nav.profile', icon: '👤', end: false },
];
