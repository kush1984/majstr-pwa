import { routes } from '@/lib/config.ts';

/**
 * Where a sign-in lands: the page the master was going to when the app sent him to /login (a link from the
 * Telegram bot — «Клієнт підписав кошторис» → /estimates/…), else home. Only a path inside this app: never
 * another site («//evil.example»), never back to the login or register page.
 */
export function afterLoginPath(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//') || from.startsWith('/\\')) {
    return routes.home;
  }
  if (from.startsWith(routes.login) || from.startsWith(routes.register)) return routes.home;
  return from;
}
