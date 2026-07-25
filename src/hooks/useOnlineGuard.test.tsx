import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { useOnlineGuard } from './useOnlineGuard.ts';
import { toast } from '@/hooks/useToast.ts';

vi.mock('@/hooks/useToast.ts', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => onlineManager.setOnline(true));

describe('useOnlineGuard', () => {
  it('runs the action when online', () => {
    const action = vi.fn();
    const { result } = renderHook(() => useOnlineGuard());

    result.current.guard(action)();

    expect(action).toHaveBeenCalledOnce();
    expect(toast.error).not.toHaveBeenCalled();
    expect(result.current.offlineTitle).toBeUndefined();
  });

  it('blocks the action offline and explains why instead of failing cryptically', () => {
    onlineManager.setOnline(false);
    const action = vi.fn();
    const { result } = renderHook(() => useOnlineGuard());

    result.current.guard(action)();

    expect(action).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Для цієї дії потрібен інтернет');
    expect(result.current.offlineTitle).toBe('Для цієї дії потрібен інтернет');
  });

  it('passes the action its arguments', () => {
    const action = vi.fn();
    const { result } = renderHook(() => useOnlineGuard());

    result.current.guard(action)('a', 2);

    expect(action).toHaveBeenCalledWith('a', 2);
  });
});
