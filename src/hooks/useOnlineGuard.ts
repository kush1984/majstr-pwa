import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { onlineManager } from '@tanstack/react-query';
import { useOnline } from '@/lib/useOnline.ts';
import { toast } from '@/hooks/useToast.ts';

/**
 * Guard for actions that GENUINELY need the server — a PDF, sharing with a client, an LLM
 * recognition, a payment, an email. These can't be queued offline (they produce something on the
 * server or send something out), so instead of failing with a cryptic network error — or, worse,
 * hanging — we tell the master plainly that a connection is needed.
 *
 * Usage: `const { online, guard } = useOnlineGuard();`
 *  - `disabled={!online}` (+ the `offlineTitle`) on the button, so the state is visible; and
 *  - `onClick={guard(doThing)}` as the safety net (a stale `online` flag, or a keyboard path).
 */
export function useOnlineGuard() {
  const online = useOnline();
  const { t } = useTranslation();

  const guard = useCallback(
    // The guarded action may be async (most of these ARE — a PDF, an upload, a payment).
    // The wrapper stays void: it is used as an onClick, and nothing downstream awaits it.
    <A extends unknown[]>(fn: (...args: A) => void | Promise<void>) =>
      (...args: A): void => {
        if (!onlineManager.isOnline()) {
          toast.error(t('offline.needConnection'));
          return;
        }
        void fn(...args);
      },
    [t],
  );

  /** `title`/tooltip for a disabled online-only control (undefined while online). */
  const offlineTitle = online ? undefined : t('offline.needConnection');

  return { online, guard, offlineTitle };
}
