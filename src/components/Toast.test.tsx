import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@/lib/i18n.ts';
import { ToastViewport } from './Toast.tsx';
import { toast } from '@/hooks/useToast.ts';

describe('ToastViewport action', () => {
  afterEach(() => {
    // Clear any toast still on screen so cases don't bleed into each other.
    act(() => {
      // Dismiss everything currently shown.
      for (let id = 1; id < 100; id += 1) toast.dismiss(id);
    });
  });

  it('renders an action button and runs its onClick, then dismisses the toast', () => {
    render(<ToastViewport />);
    const onClick = vi.fn();

    act(() => {
      toast.success('Кошторис створено', { action: { label: 'Відкрити', onClick } });
    });

    const button = screen.getByRole('button', { name: 'Відкрити' });
    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
    // The toast is gone after the action fires.
    expect(screen.queryByText('Кошторис створено')).toBeNull();
  });

  it('shows no action button for a plain toast', () => {
    render(<ToastViewport />);
    act(() => {
      toast.success('Просто повідомлення');
    });
    expect(screen.getByText('Просто повідомлення')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Відкрити' })).toBeNull();
  });
});
