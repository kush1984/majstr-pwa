import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, type RouteObject } from 'react-router-dom';
import { appRoutes } from './routes.tsx';
import { routes } from '@/lib/config.ts';

function find(list: RouteObject[], path: string): RouteObject | undefined {
  for (const r of list) {
    if (r.path === path) return r;
    const inner = r.children ? find(r.children, path) : undefined;
    if (inner) return inner;
  }
  return undefined;
}

describe('routes — object-first', () => {
  it('the old «Новий кошторис» address lands on the one creation form', () => {
    const old = find(appRoutes, routes.newEstimate);
    render(
      <MemoryRouter initialEntries={[routes.newEstimate]}>
        <Routes>
          <Route path={routes.newEstimate} element={old?.element} />
          <Route path={routes.newObject} element={<p>new-object-form</p>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('new-object-form')).toBeTruthy();
  });
});
