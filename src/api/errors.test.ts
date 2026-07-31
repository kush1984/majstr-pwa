import { describe, it, expect, afterEach } from 'vitest';
import { AxiosError } from 'axios';
import { onlineManager } from '@tanstack/react-query';
import i18n from '@/lib/i18n.ts';
import { toAppError } from './errors.ts';

afterEach(() => onlineManager.setOnline(true));

/** A request that got no answer at all — what axios throws with no connection. */
const noAnswer = () => new AxiosError('Network Error', 'ERR_NETWORK');

describe('a request that never got an answer', () => {
  it('blames the connection when WE are the ones offline', () => {
    // The complaint: a phone in flight mode was told «Сервер недоступний», which sends the master
    // looking for a fault on our side while he is standing in a basement. The guard stops actions
    // that start offline; this is the signal dropping mid-request, which is just as common.
    onlineManager.setOnline(false);

    const failure = toAppError(noAnswer());

    expect(failure.message).toBe(i18n.t('offline.needConnection'));
    expect(failure.code).toBe('NETWORK');
  });

  it('still blames the server when the connection is fine', () => {
    // The other half of the same fork: online and no answer means the server really is unreachable,
    // and saying «потрібен інтернет» there would be its own wrong-way-round lie.
    onlineManager.setOnline(true);

    const failure = toAppError(noAnswer());

    expect(failure.message).toBe(i18n.t('errors.network'));
    expect(failure.code).toBe('NETWORK');
  });

  it('leaves a real backend error exactly as the backend worded it', () => {
    // Regression guard: the offline fork must not swallow a structured answer. A server that
    // replies is a server that was reached, whatever navigator.onLine happens to think.
    onlineManager.setOnline(false);
    const withBody = new AxiosError('Request failed', '400', undefined, undefined, {
      status: 400,
      data: { message: 'Ліміт обʼєктів для FREE', code: 'LIMIT_EXCEEDED', status: 400 },
    } as never);

    const failure = toAppError(withBody);

    expect(failure.message).toBe('Ліміт обʼєктів для FREE');
    expect(failure.code).toBe('LIMIT_EXCEEDED');
  });
});
