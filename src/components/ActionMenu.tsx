import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn.ts';

/**
 * A row's ⋮ and the menu it drops.
 *
 * <p>It replaces a centred dialog, and the difference is not cosmetic. A dialog in the middle of
 * the screen loses the one thing a row menu has to say — WHICH row it belongs to. That is why the
 * old one had to repeat the estimate's name as a title, and why on a list of six «Кошторис від 1
 * серпня» the master still had to trust that he had tapped the right ⋮. Dropping from the button
 * answers it by position, the way every phone menu does.</p>
 *
 * <p><b>The panel is PORTALLED to the body, and that is load-bearing.</b> As an ordinary
 * absolutely-positioned child it was clipped the moment a row sat inside a rounded card — the
 * dashboard's «Останні об'єкти» box has `overflow-hidden`, so the menu came out sliced in half
 * with its label cut mid-word. No z-index fixes that; clipping is not stacking. A portal leaves
 * the clipping ancestor entirely, which is why the position has to be measured from the trigger
 * instead of inherited from it.</p>
 *
 * <p>Children get {@code close} so an action dismisses the menu before doing its work.</p>
 */
export function ActionMenu({
  ariaLabel,
  trigger,
  triggerClassName,
  children,
}: {
  ariaLabel: string;
  /** What the button shows. Defaults to the row ⋮; the notification bell passes its own. */
  trigger?: ReactNode;
  triggerClassName?: string;
  children: (close: () => void) => ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const button = triggerRef.current?.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    if (!button || !panel) return;
    // Measured, not guessed: the panel's height depends on how many actions the row has, and the
    // rows most likely to sit near the bottom of the screen are the last ones of a long list —
    // exactly where a menu opening downward would render off the edge.
    const below = button.bottom + 4;
    const dropUp = below + panel.height > window.innerHeight - 8;
    setPos({
      top: dropUp ? Math.max(8, button.top - 4 - panel.height) : below,
      right: Math.max(8, window.innerWidth - button.right),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
    // `true` for capture: the list that scrolls is usually an inner element, not the window, and a
    // menu left behind by its own row is worse than one that closes.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        // self-stretch makes it the full height of a flex row; min-h keeps it a thumb target anywhere else.
        className={triggerClassName
          ?? 'flex min-h-[44px] w-11 flex-shrink-0 items-center justify-center self-stretch text-xl leading-none text-muted'}
      >
        {trigger ?? '⋮'}
      </button>
      {open && createPortal(
        <>
          {/* Same catcher-as-scrim as the FAB: a tap anywhere else closes it, and dimming shows
              that the page behind is inert rather than leaving the master to discover it. */}
          <button
            type="button"
            aria-label={t('common.close')}
            className="fixed inset-0 z-[60] cursor-default bg-ink/35"
            onClick={() => setOpen(false)}
          />
          <div
            ref={panelRef}
            role="menu"
            style={pos
              // Parked off-screen for the one frame before it has been measured. Off-screen rather
              // than `visibility: hidden`, which would drop it out of the accessibility tree.
              ? { top: pos.top, right: pos.right }
              : { top: -9999, left: -9999 }}
            className={cn(
              'fixed z-[61] min-w-[13rem] max-w-[min(20rem,calc(100vw-2rem))]',
              'overflow-hidden rounded-2xl bg-surface py-1 shadow-card-lg ring-1 ring-black/5',
            )}
          >
            {children(() => setOpen(false))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

/** One line of an {@link ActionMenu}. 44 px tall because it is tapped with a thumb. */
export function ActionMenuItem({
  icon,
  label,
  danger,
  onClick,
}: {
  icon: string;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex min-h-[44px] w-full items-center gap-3 px-4 text-left text-sm font-semibold active:bg-surface-sunken',
        danger ? 'text-danger' : 'text-primary',
      )}
    >
      <span className="text-base leading-none">{icon}</span>
      <span className="min-w-0 flex-1 break-words">{label}</span>
    </button>
  );
}
