import { describe, it, expect } from 'vitest';
import { shouldRetryQuery, queryRetryDelay, MAX_QUERY_RETRIES } from './queryRetry.ts';

/** Minimal axios-error stub: `axios.isAxiosError` only checks `isAxiosError === true`. */
function axiosError(status?: number) {
  return {
    isAxiosError: true,
    response: status === undefined ? undefined : { status },
  };
}

describe('shouldRetryQuery', () => {
  it('retries network errors (no HTTP response)', () => {
    expect(shouldRetryQuery(0, axiosError(undefined))).toBe(true);
    expect(shouldRetryQuery(2, axiosError(undefined))).toBe(true);
  });

  it('retries 5xx server errors', () => {
    for (const s of [500, 502, 503, 599]) {
      expect(shouldRetryQuery(0, axiosError(s))).toBe(true);
    }
  });

  it('does NOT retry 4xx (auth / validation / not-found / rate-limit)', () => {
    for (const s of [400, 401, 403, 404, 409, 422, 429]) {
      expect(shouldRetryQuery(0, axiosError(s))).toBe(false);
    }
  });

  it('stops at the retry cap even for retryable errors', () => {
    expect(shouldRetryQuery(MAX_QUERY_RETRIES, axiosError(500))).toBe(false);
    expect(shouldRetryQuery(MAX_QUERY_RETRIES, axiosError(undefined))).toBe(false);
  });

  it('does not retry non-axios / unknown errors', () => {
    expect(shouldRetryQuery(0, new Error('boom'))).toBe(false);
    expect(shouldRetryQuery(0, 'nope')).toBe(false);
  });
});

describe('queryRetryDelay', () => {
  it('grows exponentially and caps at 10s', () => {
    expect(queryRetryDelay(0)).toBe(1000);
    expect(queryRetryDelay(1)).toBe(2000);
    expect(queryRetryDelay(2)).toBe(4000);
    expect(queryRetryDelay(10)).toBe(10_000);
  });
});
