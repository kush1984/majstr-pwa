/**
 * Where a Content-Security-Policy violation report goes: the Sentry project the app already reports
 * to, read off the same DSN so the build needs no second setting. `null` when there is no DSN.
 */
export function cspReportEndpoint(dsn: string | undefined): string | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const project = url.pathname.replace(/^\//, '');
    if (!url.username || !project) return null;
    return `${url.protocol}//${url.host}/api/${project}/security/?sentry_key=${url.username}`;
  } catch {
    return null;
  }
}

/**
 * The text of `_headers` with the report address filled in, or the directive gone when there is none.
 * Matches the whole directive because the file's comments name the placeholder too, and `replace`
 * takes only the first it finds.
 */
export function withCspReportAddress(headers: string, endpoint: string | null): string {
  return endpoint
    ? headers.replace('report-uri __CSP_REPORT_URI__', `report-uri ${endpoint}`)
    : headers.replace('; report-uri __CSP_REPORT_URI__', '');
}
