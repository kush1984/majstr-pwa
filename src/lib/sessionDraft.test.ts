import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { clearSessionDrafts, readSessionDraft, useSessionDraft } from './sessionDraft.ts';

describe('useSessionDraft (review P1-2)', () => {
  it('a value typed into the form is there again after a reload, until it is cleared', () => {
    const first = renderHook(() => useSessionDraft('newObject.project', { name: '', address: '' }));
    act(() => first.result.current[1]({ name: 'Квартира', address: 'вул. Сонячна 5' }));
    first.unmount();

    const reloaded = renderHook(() => useSessionDraft('newObject.project', { name: '', address: '' }));
    expect(reloaded.result.current[0]).toEqual({ name: 'Квартира', address: 'вул. Сонячна 5' });

    clearSessionDrafts('newObject.');
    expect(readSessionDraft('newObject.project')).toBeUndefined();
  });
});
