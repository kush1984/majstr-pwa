/** The 4 primary surfaces, shared by the desktop sidebar and mobile bottom nav. */
export interface NavItem {
  to: string;
  label: string;
  icon: string;
  end: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Головна', icon: '🏠', end: true },
  { to: '/projects', label: "Об'єкти", icon: '📁', end: false },
  { to: '/catalog', label: 'Каталог', icon: '📖', end: false },
  { to: '/profile', label: 'Я', icon: '👤', end: false },
];
