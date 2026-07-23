import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { useOnline } from './useOnline.ts';

afterEach(() => act(() => onlineManager.setOnline(true)));

describe('useOnline', () => {
  it('tracks the TanStack online manager and re-renders on change', () => {
    const { result } = renderHook(() => useOnline());
    expect(result.current).toBe(true);

    act(() => onlineManager.setOnline(false));
    expect(result.current).toBe(false);

    act(() => onlineManager.setOnline(true));
    expect(result.current).toBe(true);
  });
});
