import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { toast } from '@/hooks/useToast.ts';
import { messagesApi } from '@/api/messages.ts';
import { formatDate } from '@/lib/format.ts';
import type { MessageFileView } from '@/api/types.ts';
import { messagesKey } from './useMessages.ts';

/** Human size, matching what the public form shows the sender. */
function humanSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} МБ`
    : `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

/**
 * Attachments on a message — photos and PDFs from whoever the master gave the link to.
 *
 * <p>Nothing is fetched until the master asks for it. Thumbnails would mean downloading every photo on
 * every object opened, on mobile data, and the master usually only wants one — so a row is a name and a
 * size until tapped.</p>
 *
 * <p>A photo opens in a sheet; a PDF is handed to the browser. Both go through an authenticated fetch,
 * so the object URL is revoked once it is no longer on screen.</p>
 *
 * <p>A file the six-month sweep has warned about says so, with the date. Opening it cancels that on the
 * server — so the row that carried the warning simply stops carrying it, which is the only instruction
 * the master needs.</p>
 */
export function MessageAttachments({
  projectId,
  messageId,
  files,
}: {
  projectId: string;
  messageId: string;
  files: MessageFileView[];
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  /** Every object URL handed out, so none is left dangling when this unmounts. */
  const created = useRef<string[]>([]);

  useEffect(() => {
    const urls = created.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  if (files.length === 0) return null;

  const open = async (file: MessageFileView) => {
    setBusyId(file.id);
    try {
      const url = await messagesApi.fetchFileUrl(projectId, messageId, file.id);
      created.current.push(url);
      // Opening it cleared the deletion warning server-side. Refresh the list so the marker actually
      // goes away — otherwise the master saved the file and has no way to see that they did.
      if (file.deleteAfter) {
        void qc.invalidateQueries({ queryKey: messagesKey(projectId) });
      }
      if (file.isImage) {
        setPreview({ url, name: file.name ?? t('messages.attachment') });
      } else {
        // A PDF goes to the browser's own viewer. noopener because window.open hands the new context a
        // reference back to this one otherwise.
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch {
      toast.error(t('messages.fileOpenFailed'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <ul className="mt-2 space-y-1">
        {files.map((file) => (
          <li key={file.id}>
            <button
              type="button"
              onClick={() => void open(file)}
              disabled={busyId === file.id}
              // Tinted against the message CARD, not the panel behind it — surface-sunken is the
              // panel's own colour now and an attachment row in it would disappear.
              className="flex w-full min-h-[40px] items-center gap-2 rounded-lg border border-border/70 bg-canvas px-2.5 py-1.5 text-left"
            >
              <span className="flex-shrink-0 text-base">{file.isImage ? '🖼️' : '📄'}</span>
              {/* The name is the sender's own string — plain text, never markup. */}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-primary">
                  {file.name ?? t('messages.attachment')}
                </span>
                {file.deleteAfter && (
                  <span className="block text-[11px] font-medium text-danger">
                    {t('messages.deleteAfter', { date: formatDate(file.deleteAfter) })}
                  </span>
                )}
              </span>
              <span className="flex-shrink-0 text-[11px] text-muted">
                {busyId === file.id ? <Spinner size="sm" /> : humanSize(file.sizeBytes)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        title={preview?.name ?? t('messages.attachment')}
      >
        {preview && (
          <img
            src={preview.url}
            alt={preview.name}
            className="mx-auto max-h-[70dvh] w-auto max-w-full rounded-lg"
          />
        )}
      </Modal>
    </>
  );
}
