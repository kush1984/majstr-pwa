import { describe, it, expect } from 'vitest';
import { NAV_ITEMS, navItemActive } from './navItems.ts';

describe('NAV_ITEMS', () => {
  it('is the four places of SPEC E — Головна · Обʼєкти · Каталог · Я', () => {
    expect(NAV_ITEMS.map((i) => i.to)).toEqual(['/', '/projects', '/catalog', '/profile']);
  });

  it('keeps «Каталог» lit on its «Шаблони» tab, which still lives at /templates', () => {
    const catalog = NAV_ITEMS.find((i) => i.to === '/catalog');
    expect(catalog).toBeDefined();
    if (!catalog) return;
    expect(navItemActive(catalog, '/templates', false)).toBe(true);
    expect(navItemActive(catalog, '/templates/x', false)).toBe(true);
    expect(navItemActive(catalog, '/templatesque', false)).toBe(false);
    expect(navItemActive(catalog, '/projects', false)).toBe(false);
  });
});
