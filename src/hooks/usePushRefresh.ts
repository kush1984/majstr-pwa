import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Refresh the counts when a push arrives while the app is open.
 *
 * <p>A push is the only time the server has news the app never asked for. The service worker shows the
 * notification and posts a message here; this turns that into a refetch of the things a new message
 * changes — the object list (which carries the unread counts behind the header bell and the row
 * badges), the dashboard, and the open object's own messages.</p>
 *
 * <p>Without it the notification appeared and the bell stayed on its old number until the master
 * refreshed by hand, which is exactly how it read: as if the message had not arrived.</p>
 */
export function usePushRefresh() {
  const qc = useQueryClient();

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      // Only our own worker's messages, and only the shape we send.
      if ((event.data as { type?: string } | null)?.type !== 'push') return;
      void qc.invalidateQueries({ queryKey: ['projects'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['project-messages'] });
    };

    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [qc]);
}
