import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn.ts';

/**
 * Responsive modal: a bottom sheet on mobile (slides up, rounded top),
 * a centred dialog on desktop. Closes on backdrop click or Escape.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  size = 'md',
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Desktop width cap. Mobile is always a full-width bottom sheet. */
  size?: 'md' | 'lg';
  /** When false, hide the ✕ and ignore backdrop/Escape — a required dialog the
   *  user must resolve via an in-content action (e.g. consent). */
  dismissable?: boolean;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (dismissable && e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose, dismissable]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label={t('common.close')}
        className="absolute inset-0 bg-black/40"
        onClick={dismissable ? onClose : undefined}
        disabled={!dismissable}
      />
      <div
        className={cn(
          'relative z-10 max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-card-lg sm:rounded-2xl',
          size === 'lg' ? 'max-w-xl' : 'max-w-md',
        )}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-primary">{title}</h2>
          {dismissable && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              className="text-lg text-faint hover:text-muted"
            >
              ✕
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
