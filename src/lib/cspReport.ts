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
