import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/lib/i18n.ts';
import { UpdateBanner } from './UpdateBanner.tsx';
import { markUpdateReady } from '@/lib/swUpdate.ts';

describe('UpdateBanner', () => {
  it('is hidden until a new version is ready, then shows and applies the update on click', () => {
    const { rerender } = render(<UpdateBanner />);
    expect(screen.queryByText('Доступна нова версія')).toBeNull();

    const apply = vi.fn();
    markUpdateReady(apply); // the SW registration would call this when a build is waiting
    rerender(<UpdateBanner />);

    expect(screen.getByText('Доступна нова версія')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Оновити' }));
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
