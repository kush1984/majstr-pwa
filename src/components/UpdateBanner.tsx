import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { applyUpdate, isUpdateReady, subscribeUpdate } from '@/lib/swUpdate.ts';

/**
 * Non-intrusive "a new version is available" banner. Shown when a new build's service
 * worker is waiting (see `lib/swUpdate.ts`). The master taps «Оновити» when ready — we
 * never reload silently, so unsaved form input (e.g. a 30-line estimate) isn't lost.
 */
export function UpdateBanner() {
  const { t } = useTranslation();
  const [ready, setReady] = useState(isUpdateReady);

  useEffect(() => subscribeUpdate(() => setReady(true)), []);

  if (!ready) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-between gap-3 bg-gray-900 px-4 py-3 text-sm text-white shadow-lg"
      style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
    >
      <span>{t('update.available')}</span>
      <button
        type="button"
        onClick={applyUpdate}
        className="flex-shrink-0 rounded-lg bg-brand-600 px-4 py-1.5 font-semibold text-white hover:bg-brand-700"
      >
        {t('update.reload')}
      </button>
    </div>
  );
}
