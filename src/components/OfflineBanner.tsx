import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Sticky banner shown while the browser reports no network. The PWA shell boots
 * from cache offline, but every `/api/*` call then fails — without this, the
 * user just sees errors with no explanation. Subscribes to the `online` /
 * `offline` events; renders nothing when connected.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const [offline, setOffline] = useState(() => !navigator.onLine);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-white shadow-sm"
    >
      {t('errors.offlineBanner')}
    </div>
  );
}
