import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cspReportEndpoint, withCspReportAddress } from './cspReport.ts';

const headers = readFileSync(resolve(__dirname, '../../public/_headers'), 'utf-8');
const indexHtml = readFileSync(resolve(__dirname, '../../index.html'), 'utf-8');

function policyOf(text: string): string {
  return /Content-Security-Policy(?:-Report-Only)?: (.+)/.exec(text)?.[1] ?? '';
}

const policy = policyOf(headers);

function directive(name: string): string[] {
  return policy
    .split(';')
    .map((d) => d.trim().split(/\s+/))
    .find((d) => d[0] === name)?.slice(1) ?? [];
}

/**
 * The policy reads as a text file, so nothing but these tests notices it drifting from what it guards
 * (P-79). It ran report-only for two months without being able to be enforced: the API origin was
 * missing, so the moment it was switched on, every request would have been blocked.
 */
describe('public/_headers', () => {
  it('lets the app reach its API, which lives on its own origin', () => {
    expect(directive('connect-src')).toContain('https://api.majstr.pro');
    expect(directive('img-src')).toContain('https://api.majstr.pro');
  });

  it('refuses framing today: frame-ancestors does nothing while the policy is report-only', () => {
    expect(headers).toMatch(/^\s*X-Frame-Options: DENY$/m);
  });

  it('sends its reports somewhere somebody can read them', () => {
    expect(directive('report-uri')).toEqual(['__CSP_REPORT_URI__']);
  });

  it('allows the inline boot script by the hash of what index.html really contains', () => {
    const inline = /<script>(.*?)<\/script>/s.exec(indexHtml)?.[1] ?? '';
    const hash = createHash('sha256').update(inline).digest('base64');

    expect(directive('script-src')).toContain(`'sha256-${hash}'`);
  });

  it('is enforced by the end of November: report-only is a stage, not a resting place', () => {
    // Failing here means: read the reports in Sentry, add any missing origin, rename the header to
    // Content-Security-Policy, and delete this test. Move the date only with a reason written next to it.
    const deadline = new Date('2026-11-30T00:00:00Z');
    if (Date.now() > deadline.getTime()) {
      expect(headers).not.toContain('Content-Security-Policy-Report-Only');
    }
  });
});

describe('cspReportEndpoint', () => {
  it("turns a DSN into Sentry's security endpoint", () => {
    expect(cspReportEndpoint('https://abc123@o1.ingest.de.sentry.io/42')).toBe(
      'https://o1.ingest.de.sentry.io/api/42/security/?sentry_key=abc123',
    );
  });

  it('answers nothing for a blank or broken DSN', () => {
    expect(cspReportEndpoint('')).toBeNull();
    expect(cspReportEndpoint(undefined)).toBeNull();
    expect(cspReportEndpoint('not a url')).toBeNull();
  });
});

describe('withCspReportAddress', () => {
  it('fills the policy itself, though the comments above it name the placeholder first', () => {
    const endpoint = 'https://o1.ingest.de.sentry.io/api/42/security/?sentry_key=abc123';

    const filled = policyOf(withCspReportAddress(headers, endpoint));

    expect(filled).toContain(`report-uri ${endpoint}`);
    expect(filled).not.toContain('__CSP_REPORT_URI__');
  });

  it('drops the directive when there is nowhere to send reports', () => {
    expect(policyOf(withCspReportAddress(headers, null))).not.toContain('report-uri');
  });
});
