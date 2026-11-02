import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import axios, { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import {
  api,
  ensureAccessToken,
  fetchTimeoutSignal,
  FETCH_TIMEOUT_MS,
  LLM_TIMEOUT_MS,
  rawApi,
  REFRESH_TIMEOUT_MS,
  REGISTER_TIMEOUT_MS,
} from './client.ts';
import { authApi } from './auth.ts';
import { tokens } from '@/lib/tokens.ts';

/**
 * Tests the refresh-failure classification (dead token → logout vs transient
 * → keep tokens), the single-flight guarantee, and the 401-retry path.
 *
 * `axios.post` (the raw refresh call) is spied per test; `api` requests are
 * driven through a mock adapter so no real network is involved.
 */

// jsdom can't navigate; give `forceLogin` a plain object to write to so the
// redirect assignment is observable and silent.
beforeAll(() => {
  Object.defineProperty(window, 'location', {
    value: { href: 'http://localhost/', pathname: '/' },
    writable: true,
  });
});

/** Decodable fake JWT with the given expiry offset (seconds from now). */
function makeJwt(expInSeconds: number): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expInSeconds }));
  return `header.${payload}.signature`;
}

function authResponse(access: string, refresh: string) {
  return { data: { accessToken: access, refreshToken: refresh } };
}

function axiosErrorWithStatus(status: number, data?: unknown): AxiosError {
  const err = new AxiosError(`Request failed with status code ${status}`);
  err.response = { status, data } as AxiosResponse;
  return err;
}

const backendError = { status: 400, error: 'Bad Request', message: 'Некоректні дані', path: '/api/auth/refresh' };

function networkError(): AxiosError {
  return new AxiosError('Network Error', AxiosError.ERR_NETWORK);
}

const realAdapter = api.defaults.adapter;

beforeEach(() => {
  localStorage.clear();
  window.location.pathname = '/';
});

afterEach(() => {
  vi.restoreAllMocks();
  api.defaults.adapter = realAdapter;
});

describe('ensureAccessToken / refresh classification', () => {
  it('returns the stored token untouched when it is not expired', async () => {
    const access = makeJwt(+3600);
    tokens.set(access, 'refresh-1');
    const post = vi.spyOn(axios, 'post');

    await expect(ensureAccessToken()).resolves.toBe(access);
    expect(post).not.toHaveBeenCalled();
  });

  it('refreshes an expired token and stores the rotated pair', async () => {
    tokens.set(makeJwt(-60), 'refresh-old');
    vi.spyOn(axios, 'post').mockResolvedValue(authResponse('new-access', 'refresh-new'));

    await expect(ensureAccessToken()).resolves.toBe('new-access');
    expect(tokens.getAccess()).toBe('new-access');
    expect(tokens.getRefresh()).toBe('refresh-new'); // rotation honoured
  });

  it.each([
    ['401', axiosErrorWithStatus(401)],
    ["400 in the backend's own shape", axiosErrorWithStatus(400, backendError)],
  ])('%s from /refresh = dead auth: resolves null and clears tokens', async (_name, refusal) => {
    tokens.set(makeJwt(-60), 'refresh-revoked');
    vi.spyOn(axios, 'post').mockRejectedValue(refusal);

    await expect(ensureAccessToken()).resolves.toBeNull();
    expect(tokens.getAccess()).toBeNull(); // forceLogin cleared storage
    expect(tokens.getRefresh()).toBeNull();
  });

  it.each([
    ['a bare 400 from an edge', axiosErrorWithStatus(400, '<html>Bad Request</html>')],
    ['a 400 with some other JSON', axiosErrorWithStatus(400, { reason: 'blocked' })],
    ['a 403 from a WAF', axiosErrorWithStatus(403)],
    ['a 404 during a deploy', axiosErrorWithStatus(404)],
    ['a 408', axiosErrorWithStatus(408)],
    ['a 413', axiosErrorWithStatus(413)],
    ['a 429', axiosErrorWithStatus(429)],
  ])('%s says nothing about the token: rejects and KEEPS tokens', async (_name, answer) => {
    const access = makeJwt(-60);
    tokens.set(access, 'refresh-1');
    vi.spyOn(axios, 'post').mockRejectedValue(answer);

    await expect(ensureAccessToken()).rejects.toBe(answer);
    expect(tokens.getAccess()).toBe(access);
    expect(tokens.getRefresh()).toBe('refresh-1');
  });

  it('a 200 with no tokens in it is somebody else\'s page: rejects and KEEPS tokens', async () => {
    const access = makeJwt(-60);
    tokens.set(access, 'refresh-1');
    vi.spyOn(axios, 'post').mockResolvedValue({ data: '<html>Sign in to the Wi-Fi</html>' });

    await expect(ensureAccessToken()).rejects.toThrow();
    expect(tokens.getAccess()).toBe(access);
    expect(tokens.getRefresh()).toBe('refresh-1');
  });

  it('a refresh that never answers gives up at its timeout, keeps tokens, and the next call tries again', async () => {
    vi.useFakeTimers();
    try {
      const access = makeJwt(-60);
      tokens.set(access, 'refresh-1');
      // What the real adapter does with `timeout`: it rejects, once that long has passed.
      const post = vi.spyOn(axios, 'post').mockImplementationOnce(
        (_url, _body, cfg) =>
          new Promise((_resolve, reject) => {
            setTimeout(
              () => reject(new AxiosError('timeout', AxiosError.ECONNABORTED)),
              cfg?.timeout ?? Number.POSITIVE_INFINITY,
            );
          }),
      );

      const stalled = expect(ensureAccessToken()).rejects.toMatchObject({ code: AxiosError.ECONNABORTED });
      await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS);
      await stalled;
      expect(tokens.getAccess()).toBe(access);
      expect(tokens.getRefresh()).toBe('refresh-1');

      post.mockResolvedValueOnce(authResponse('new-access', 'refresh-new'));
      await expect(ensureAccessToken()).resolves.toBe('new-access');
      expect(post).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('every request behind a stalled refresh is released with it', async () => {
    vi.useFakeTimers();
    try {
      tokens.set(makeJwt(-60), 'refresh-1');
      vi.spyOn(axios, 'post').mockImplementationOnce(
        (_url, _body, cfg) =>
          new Promise((_resolve, reject) => {
            setTimeout(
              () => reject(new AxiosError('timeout', AxiosError.ECONNABORTED)),
              cfg?.timeout ?? Number.POSITIVE_INFINITY,
            );
          }),
      );
      const adapter = vi.fn();
      api.defaults.adapter = adapter;

      const waiting = Promise.allSettled([api.get('/api/one'), api.get('/api/two')]);
      await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS);

      const results = await waiting;
      expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
      expect(adapter).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('network error during refresh is transient: rejects and KEEPS tokens', async () => {
    const access = makeJwt(-60);
    tokens.set(access, 'refresh-1');
    vi.spyOn(axios, 'post').mockRejectedValue(networkError());

    await expect(ensureAccessToken()).rejects.toThrow();
    expect(tokens.getAccess()).toBe(access); // session survives the blip
    expect(tokens.getRefresh()).toBe('refresh-1');
  });

  it('5xx during refresh is transient: rejects and KEEPS tokens', async () => {
    const access = makeJwt(-60);
    tokens.set(access, 'refresh-1');
    vi.spyOn(axios, 'post').mockRejectedValue(axiosErrorWithStatus(503));

    await expect(ensureAccessToken()).rejects.toThrow();
    expect(tokens.getAccess()).toBe(access);
    expect(tokens.getRefresh()).toBe('refresh-1');
  });

  it('single-flight: concurrent callers trigger exactly one refresh', async () => {
    tokens.set(makeJwt(-60), 'refresh-1');
    const post = vi
      .spyOn(axios, 'post')
      .mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(authResponse('new-access', 'refresh-new')), 20),
          ),
      );

    const [a, b, c] = await Promise.all([
      ensureAccessToken(),
      ensureAccessToken(),
      ensureAccessToken(),
    ]);
    expect(a).toBe('new-access');
    expect(b).toBe('new-access');
    expect(c).toBe('new-access');
    expect(post).toHaveBeenCalledTimes(1); // no race-rotation
  });
});

describe('calls outside the axios instance also have a ceiling', () => {
  function stubRawRequest() {
    return vi.spyOn(axios, 'request').mockResolvedValue({ data: {} });
  }

  it('rawApi applies a timeout by default', async () => {
    const request = stubRawRequest();

    await rawApi({ method: 'POST', url: '/api/auth/login' });

    expect(request.mock.calls[0][0].timeout).toBeGreaterThan(0);
  });

  it('registration gets longer, because it seeds a catalog before answering', async () => {
    const request = stubRawRequest();

    await authApi.register({} as Parameters<typeof authApi.register>[0]);

    expect(request.mock.calls[0][0].timeout).toBe(REGISTER_TIMEOUT_MS);
  });

  it('a bearer fetch gets a signal that fires at the fetch ceiling', () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');

    expect(fetchTimeoutSignal()).toBeInstanceOf(AbortSignal);
    expect(timeout).toHaveBeenCalledWith(FETCH_TIMEOUT_MS);
  });

  it('a phone without AbortSignal.timeout still fetches, with no signal', () => {
    vi.stubGlobal('AbortSignal', {});
    try {
      expect(fetchTimeoutSignal()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('api 401-retry interceptor', () => {
  it('on 401: refreshes once and retries the original request with the new bearer', async () => {
    // Undecodable token → the proactive check stays out of the way and the
    // server-side 401 path is exercised.
    tokens.set('opaque-token', 'refresh-1');
    vi.spyOn(axios, 'post').mockResolvedValue(authResponse('fresh-access', 'refresh-new'));

    const adapter = vi
      .fn()
      .mockImplementationOnce((config) => {
        const err = new AxiosError('Unauthorized', '401', config, null, {
          status: 401,
          statusText: 'Unauthorized',
          headers: {},
          config,
          data: {},
        } as AxiosResponse);
        return Promise.reject(err);
      })
      .mockImplementationOnce((config) =>
        Promise.resolve({
          data: { ok: true },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        } as AxiosResponse),
      );
    api.defaults.adapter = adapter;

    const resp = await api.get('/api/test');
    expect(resp.data).toEqual({ ok: true });
    expect(adapter).toHaveBeenCalledTimes(2); // original + exactly one retry

    const retryHeaders = AxiosHeaders.from(adapter.mock.calls[1][0].headers);
    expect(retryHeaders.get('Authorization')).toBe('Bearer fresh-access');
  });

  it('on 401 + transient refresh failure: rejects with the original 401 and keeps tokens', async () => {
    tokens.set('opaque-token', 'refresh-1');
    vi.spyOn(axios, 'post').mockRejectedValue(networkError());

    const adapter = vi.fn().mockImplementation((config) => {
      const err = new AxiosError('Unauthorized', '401', config, null, {
        status: 401,
        statusText: 'Unauthorized',
        headers: {},
        config,
        data: {},
      } as AxiosResponse);
      return Promise.reject(err);
    });
    api.defaults.adapter = adapter;

    await expect(api.get('/api/test')).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(adapter).toHaveBeenCalledTimes(1); // no blind retry
    expect(tokens.getAccess()).toBe('opaque-token'); // tokens kept
    expect(tokens.getRefresh()).toBe('refresh-1');
  });

  // Regression: a global JSON Content-Type used to ride along on FormData bodies, so every
  // file upload reached Spring as application/json and died with 415. Real masters hit this
  // on sketch/parse in production (Sentry JAVA-SPRING-BOOT-D).
  it('drops the JSON Content-Type on FormData so the browser can set the multipart boundary', async () => {
    tokens.set('opaque-token', 'refresh-1');
    const adapter = vi.fn().mockImplementation((config) =>
      Promise.resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config }),
    );
    api.defaults.adapter = adapter;

    const form = new FormData();
    form.append('file', new File(['x'], 'plan.pdf', { type: 'application/pdf' }));
    await api.post('/api/projects/p1/measurements/sketch/parse', form);

    // axios uses `false` as "send no Content-Type" — the browser then fills in
    // multipart/form-data with its boundary. What must never happen is application/json.
    const sent = adapter.mock.calls[0][0];
    expect(sent.headers['Content-Type']).not.toBe('application/json');
    expect(sent.headers['Content-Type']).toBeFalsy();
  });

  // A recognition call waits on an LLM reading a drawing. The instance default is 12s (there to make
  // an offline WRITE fail fast into the outbox), the server allows 120s for the same call — so the
  // default silently aborted every import while the tokens were still billed, and the server log was
  // clean because nothing had failed server-side. Pinned per path, not per call site.
  it('gives a recognition call the LLM timeout, not the 12s write default', async () => {
    tokens.set('opaque-token', 'refresh-1');
    const adapter = vi.fn().mockImplementation((config) =>
      Promise.resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config }),
    );
    api.defaults.adapter = adapter;

    const form = new FormData();
    form.append('file', new File(['x'], 'plan.pdf', { type: 'application/pdf' }));
    await api.post('/api/projects/p1/measurements/project/parse', form);

    expect(adapter.mock.calls[0][0].timeout).toBe(LLM_TIMEOUT_MS);
    // The value has to clear the server's own ceiling for one LLM pass, or the client abandons a
    // call the server is still legitimately working on.
    expect(LLM_TIMEOUT_MS).toBeGreaterThan(120_000);
  });

  // Same rule, other verb: the act's receipt read is `…/receipts/recognize`, and it inherited the
  // 12s default until this was widened — the footer pass sometimes made it, the full item read
  // never did, so «розпізнати позиції» looked like it silently did nothing.
  it('gives an act receipt /recognize call the LLM timeout too', async () => {
    tokens.set('opaque-token', 'refresh-1');
    const adapter = vi.fn().mockImplementation((config) =>
      Promise.resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config }),
    );
    api.defaults.adapter = adapter;

    const form = new FormData();
    form.append('file', new File(['x'], 'check.jpg', { type: 'image/jpeg' }));
    await api.post('/api/acts/a1/receipts/recognize', form);

    expect(adapter.mock.calls[0][0].timeout).toBe(LLM_TIMEOUT_MS);
  });

  it('keeps the short fail-fast timeout on an ordinary write', async () => {
    // The 12s default earns its keep on writes: a phone on one bar reports "online", and a write
    // that hangs on a dead socket never reaches the outbox. Raising it globally would lose that.
    tokens.set('opaque-token', 'refresh-1');
    const adapter = vi.fn().mockImplementation((config) =>
      Promise.resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config }),
    );
    api.defaults.adapter = adapter;

    await api.post('/api/projects', { name: 'Обʼєкт' });

    expect(adapter.mock.calls[0][0].timeout).toBe(12_000);
  });

  it('still sends application/json for ordinary JSON bodies', async () => {
    tokens.set('opaque-token', 'refresh-1');
    const adapter = vi.fn().mockImplementation((config) =>
      Promise.resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config }),
    );
    api.defaults.adapter = adapter;

    await api.post('/api/estimates', { name: 'x' });

    expect(adapter.mock.calls[0][0].headers['Content-Type']).toBe('application/json');
  });

  // Backend messages localise by Accept-Language; the BROWSER's own header (en on an
  // English OS) used to ride along, so a master saw «Too many PDF pages…» in English.
  it('always sends the app language as Accept-Language', async () => {
    tokens.set('opaque-token', 'refresh-1');
    const adapter = vi.fn().mockImplementation((config) =>
      Promise.resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config }),
    );
    api.defaults.adapter = adapter;

    await api.get('/api/projects');

    expect(adapter.mock.calls[0][0].headers['Accept-Language']).toBe('uk');
  });
});
