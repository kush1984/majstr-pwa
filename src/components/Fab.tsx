import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn.ts';

/**
 * The floating action button, extracted from the estimate editor so every screen gets the same one.
 *
 * <p>It exists because a phone has no room for a column of full-width action cards: they push the
 * actual content — the estimates, the messages — below the fold. Actions that are occasional belong
 * behind one thumb-reachable button.</p>
 *
 * <p>Children are {@link FabAction} rows. `close()` is passed to them so an action dismisses the menu
 * before doing its work — a sheet opening under a still-expanded FAB looks broken.</p>
 */
export function Fab({
  ariaLabel,
  children,
}: {
  ariaLabel: string;
  children: (close: (fn?: () => void) => void) => ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const close = (fn?: () => void) => {
    setOpen(false);
    fn?.();
  };

  return (
    <>
      {open && (
        // A full-screen catcher rather than an onBlur: a tap anywhere else has to close the menu, and
        // on a touch screen there is no blur to hang that on.
        <button
          type="button"
          aria-label={t('common.close')}
          className="fixed inset-0 z-40 cursor-default"
          onClick={() => setOpen(false)}
        />
      )}
      {/*
        bottom-20 (80 px), not bottom-32. At 128 px the button floated a long way up into the page
        and sat on top of whatever happened to be there — on the object screen that was the
        messages card. Just above the bottom nav is where a floating action belongs, and the
        content's own bottom padding (AppLayout) is what keeps it from covering anything.
      */}
      <div className="fixed bottom-20 right-4 z-50 flex flex-col items-end gap-2 lg:bottom-8 lg:right-8">
        {open && children(close)}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={ariaLabel}
          aria-expanded={open}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-card-lg transition-transform active:scale-95"
        >
          <span className={cn('text-3xl leading-none transition-transform', open && 'rotate-45')}>
            ＋
          </span>
        </button>
      </div>
    </>
  );
}

export function FabAction({
  icon,
  label,
  onClick,
}: {
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-full bg-surface py-2.5 pl-4 pr-5 text-sm font-semibold text-primary shadow-card-lg active:scale-95"
    >
      <span className="text-base leading-none">{icon}</span>
      {label}
    </button>
  );
}
