import { describe, it, expect } from 'vitest';
import type * as SentryType from '@sentry/react';
import { scrubEvent, scrubBreadcrumb } from './sentry.ts';

describe('scrubEvent (Sentry beforeSend)', () => {
  it('redacts auth headers, request body and token query params', () => {
    const event = {
      request: {
        url: 'https://api.majstr.pro/api/estimates?access_token=secret&q=1',
        headers: {
          Authorization: 'Bearer abc.def.ghi',
          Cookie: 'session=xyz',
          'X-Trace-Id': 'keep-me',
        },
        data: { password: 'hunter2', refreshToken: 'r0' },
      },
    } as unknown as SentryType.ErrorEvent;

    const out = scrubEvent(event)!;
    const req = out.request!;
    const headers = req.headers as Record<string, string>;

    expect(headers.Authorization).toBe('[redacted]');
    expect(headers.Cookie).toBe('[redacted]');
    expect(headers['X-Trace-Id']).toBe('keep-me'); // non-sensitive kept
    expect(req.url).toBe('https://api.majstr.pro/api/estimates?access_token=[redacted]&q=1');
    expect(req.data).toBe('[redacted]'); // body never shipped
  });

  it('leaves events without a request untouched', () => {
    const event = { message: 'boom' } as unknown as SentryType.ErrorEvent;
    expect(scrubEvent(event)).toBe(event);
  });
});

describe('scrubBreadcrumb (Sentry beforeBreadcrumb)', () => {
  it('drops breadcrumbs for credential-bearing auth calls', () => {
    const crumb = {
      category: 'xhr',
      data: { url: 'https://api.majstr.pro/api/auth/login' },
    } as SentryType.Breadcrumb;
    expect(scrubBreadcrumb(crumb)).toBeNull();
  });

  it('redacts token query params on other URLs', () => {
    const crumb = {
      category: 'xhr',
      data: { url: 'https://api.majstr.pro/api/estimates?token=secret' },
    } as SentryType.Breadcrumb;
    const out = scrubBreadcrumb(crumb)!;
    expect(out.data!.url).toBe('https://api.majstr.pro/api/estimates?token=[redacted]');
  });

  it('keeps ordinary breadcrumbs', () => {
    const crumb = { category: 'ui.click', message: 'button' } as SentryType.Breadcrumb;
    expect(scrubBreadcrumb(crumb)).toBe(crumb);
  });
});
