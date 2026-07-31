import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useOnline, useSyncStatus } from '@/lib/useOnline.ts';
import { SyncReviewSheet } from '@/components/SyncReviewSheet.tsx';

/**
 * Sticky top banner for the offline / sync state — the master's feedback that offline authoring is
 * working and where it stands:
 *  - **offline:** a saved copy is shown; unsynced changes wait (with their count);
 *  - **online + blocked:** N changes the server rejected (over the FREE limit) — tap to resolve
 *    (PRO or delete), the most urgent state;
 *  - **online + syncing:** a sync is running;
 *  - **online + queued:** N changes still waiting;
 *  - **online + nothing queued:** hidden.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const online = useOnline();
  const { pending, blocked, syncing } = useSyncStatus();
  const [reviewOpen, setReviewOpen] = useState(false);

  let bar: ReactNode = null;
  if (!online) {
    bar = (
      <Bar tone="offline">
        {t('offline.banner')}
        {pending + blocked > 0 && ` · ${t('sync.pending', { n: pending + blocked })}`}
      </Bar>
    );
  } else if (blocked > 0) {
    bar = (
      <button
        type="button"
        onClick={() => setReviewOpen(true)}
        className="sticky top-0 z-50 w-full bg-danger px-4 py-2 text-center text-sm font-semibold text-white shadow-sm"
      >
        {t('sync.blocked', { n: blocked })}
      </button>
    );
  } else if (syncing) {
    bar = <Bar tone="sync">{t('sync.syncing')}</Bar>;
  } else if (pending > 0) {
    bar = <Bar tone="pending">{t('sync.pending', { n: pending })}</Bar>;
  }

  return (
    <>
      {bar}
      {blocked > 0 && <SyncReviewSheet open={reviewOpen} onClose={() => setReviewOpen(false)} />}
    </>
  );
}

const TONE = {
  offline: 'bg-amber-500 text-white',
  sync: 'bg-brand text-white',
  pending: 'bg-amber-500 text-white',
} as const;

/**
 * `sticky`, never `fixed`.
 *
 * Fixed took the banner out of the flow, so it lay ON TOP of whatever was at the top of the page —
 * and on a phone this text wraps to three lines, which is exactly tall enough to bury a screen's
 * header. A master reported it from an estimate: offline, the back arrow was underneath the banner
 * and there was no way out of the screen. Sticky keeps it pinned while scrolling AND makes it
 * occupy its own space, so it cannot cover anything by construction.
 */
function Bar({ tone, children }: { tone: keyof typeof TONE; children: ReactNode }) {
  return (
    <div
      role="status"
      className={`sticky top-0 z-50 px-4 py-1.5 text-center text-sm font-medium shadow-sm ${TONE[tone]}`}
    >
      {children}
    </div>
  );
}
