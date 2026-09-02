import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn.ts';

/**
 * A small (i) → tap → explanation panel, for the handful of places a term or figure isn't
 * self-evident (object-status-unification) — curated placement, not one on every label. Reuses
 * {@link ActionMenu}'s proven shape (portalled to `body` so a clipping ancestor can't slice it,
 * position measured from the trigger and clamped to the viewport) rather than inventing a second
 * popover pattern, since none existed in the PWA before this.
 *
 * Closes on: a tap outside (the scrim), Esc, or the ✕ inside the panel. Mobile-first — no
 * hover-only affordance, and the (i) is a real 24px circle — it was 18px until the master said
 * he kept missing it on a phone.
 */
export function InfoPopover({ text, children, label }: { text?: string; children?: ReactNode; label?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; maxWidth: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const button = triggerRef.current?.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    if (!button || !panel) return;
    const margin = 8;
    // Anchored under the trigger, then clamped so a popover opened near the right edge on a 375px
    // phone never runs past it — the whole reason this isn't just `position: absolute`.
    const maxWidth = Math.min(288, window.innerWidth - margin * 2);
    const left = Math.min(
      Math.max(margin, button.left),
      window.innerWidth - maxWidth - margin,
    );
    const below = button.bottom + 6;
    const dropUp = below + panel.height > window.innerHeight - margin;
    setPos({
      top: dropUp ? Math.max(margin, button.top - 6 - panel.height) : below,
      left,
      maxWidth,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label ?? t('common.moreInfo')}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand-soft align-middle text-xs font-bold leading-none text-brand"
      >
        i
      </button>
      {open && createPortal(
        <>
          <button
            type="button"
            aria-label={t('common.close')}
            className="fixed inset-0 z-[60] cursor-default bg-ink/35"
            onClick={() => setOpen(false)}
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-label={label ?? t('common.moreInfo')}
            style={pos
              ? { top: pos.top, left: pos.left, width: pos.maxWidth }
              : { top: -9999, left: -9999, width: 288 }}
            className={cn(
              'fixed z-[61] rounded-2xl bg-surface p-3.5 pr-8 shadow-card-lg ring-1 ring-black/5',
              'text-[13px] leading-snug text-primary',
            )}
          >
            {children ?? text}
            <button
              type="button"
              aria-label={t('common.close')}
              onClick={() => setOpen(false)}
              className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-muted"
            >
              ✕
            </button>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
