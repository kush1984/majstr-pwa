import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { OfflineBanner } from './OfflineBanner.tsx';

afterEach(() => act(() => onlineManager.setOnline(true)));

describe('OfflineBanner', () => {
  it('renders nothing while online', () => {
    const { container } = render(<OfflineBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the saved-copy message while offline', () => {
    render(<OfflineBanner />);
    act(() => onlineManager.setOnline(false));
    expect(screen.getByRole('status')).toBeTruthy();
    // Frames the offline data as a saved copy, not a blank error.
    expect(screen.getByText(/збережену копію/)).toBeTruthy();
  });
});
