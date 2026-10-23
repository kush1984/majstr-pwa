import type { ReactNode, RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn.ts';
import { Button } from '@/components/Button.tsx';
import {
  closeModalEntry,
  dropModalEntry,
  isFormEdit,
  openModalEntry,
  restoreModalEntry,
} from '@/lib/modalHistory.ts';

/**
 * Responsive modal: a bottom sheet on mobile (slides up, rounded top),
 * a centred dialog on desktop. Closes on backdrop click or Escape.
 *
 * <p>System «Назад» closes the sheet rather than the screen (see `modalHistory.ts`), and once a
 * field in it has been typed into, a backdrop tap or «Назад» asks «Скасувати зміни?» first — the
 * ✕ and the sheet's own buttons stay deliberate and ask nothing (review P1-1).</p>
 *
 * <p>Rendered into `document.body` through a portal, which is not a detail. `position: fixed` is
 * resolved against the nearest ancestor carrying a transform, filter or containment — so a modal
 * rendered inside, say, a `-translate-y-1/2` wrapper measures `inset-0` against that wrapper and
 * collapses into a sliver of a column. Nothing about the modal's own markup hints at that, and the
 * failure looks like broken CSS rather than misplaced markup, so the escape is built in here instead of
 * being every caller's problem.</p>
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  size = 'md',
  dismissable = true,
  mask = true,
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
  /**
   * Redact the content in session replay. ON by default, and that is the whole point (review
   * P-44): a modal renders through `createPortal` into `document.body`, so it sits OUTSIDE every
   * `.ph-mask` its caller put around the screen. Payment sheets, receipt forms, the markup preview
   * and every confirm dialog were therefore recorded in full — amounts, client names, crew prices
   * — while the screen behind them was masked. A default of «masked» means a new sheet is private
   * unless someone decides otherwise, which is the right direction for the default to fail in.
   */
  mask?: boolean;
}) {
  const { t } = useTranslation();
  const panel = useRef<HTMLDivElement>(null);
  const visible = useVisibleViewport(open, panel);
  const dirty = useRef(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Callers pass an inline `onClose`; the history entry must live as long as the modal is OPEN,
  // not as long as one render's callback, so it reads the latest one through a ref.
  const latest = useRef({ onClose, dismissable });
  useEffect(() => { latest.current = { onClose, dismissable }; }, [onClose, dismissable]);

  useEffect(() => {
    if (!open) return;
    dirty.current = false;
    setConfirmDiscard(false);
    const id = openModalEntry(() => {
      if (!latest.current.dismissable || dirty.current) {
        restoreModalEntry(id);
        if (latest.current.dismissable) setConfirmDiscard(true);
        return;
      }
      dropModalEntry(id);
      latest.current.onClose();
    });
    return () => closeModalEntry(id);
  }, [open]);

  const requestDismiss = () => {
    if (dirty.current) setConfirmDiscard(true);
    else onClose();
  };
  const markDirty = (e: { target: EventTarget | null }) => {
    if (isFormEdit(e.target)) dirty.current = true;
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (dismissable && e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    // iOS-safe scroll lock. `overflow: hidden` on <body> does NOT stop iOS Safari from scrolling the
    // page behind a fixed overlay — focusing an input in the modal makes iOS scroll the list, and on
    // close the list is left scrolled down (the master's «після Зберегти стрибає майже вниз»; Android
    // honours overflow:hidden, so it never showed there). Freezing the body with position:fixed at its
    // current offset actually holds it, and the exact scroll is restored on close. A nested modal must
    // not re-lock or it would restore to the wrong place, so only the FIRST one locks/unlocks.
    const body = document.body;
    const alreadyLocked = body.style.position === 'fixed';
    const scrollY = window.scrollY;
    if (!alreadyLocked) {
      body.style.position = 'fixed';
      body.style.top = `-${scrollY}px`;
      body.style.left = '0';
      body.style.right = '0';
      body.style.width = '100%';
    }

    return () => {
      document.removeEventListener('keydown', onKey);
      if (!alreadyLocked) {
        body.style.position = '';
        body.style.top = '';
        body.style.left = '';
        body.style.right = '';
        body.style.width = '';
        window.scrollTo(0, scrollY);
      }
    };
  }, [open, onClose, dismissable]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={visible ? { top: visible.top, height: visible.height, bottom: 'auto' } : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label={t('common.close')}
        className="absolute inset-0 bg-black/40"
        onClick={dismissable ? requestDismiss : undefined}
        disabled={!dismissable}
      />
      <div
        ref={panel}
        className={cn(
          'relative z-10 max-h-[90%] w-full overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-card-lg sm:rounded-2xl',
          size === 'lg' ? 'max-w-xl' : 'max-w-md',
          mask && 'ph-mask',
        )}
        onInputCapture={markDirty}
        onChangeCapture={markDirty}
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
      {/* Over the whole dialog, not inside the panel: the panel scrolls, and an overlay inside it
          would scroll away with the content. */}
      {confirmDiscard && (
        <div role="alertdialog" aria-label={t('common.discardChangesTitle')}
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 p-5">
          <div className="w-full max-w-xs space-y-3 rounded-2xl bg-surface p-5 text-center shadow-card-lg">
            <p className="text-base font-bold text-primary">{t('common.discardChangesTitle')}</p>
            <Button fullWidth onClick={() => setConfirmDiscard(false)}>{t('common.keepEditing')}</Button>
            <Button fullWidth variant="secondary" onClick={onClose}>{t('common.discardChanges')}</Button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

/**
 * The sheet's actions and running result, kept on screen while the form above them scrolls. Sticky
 * inside the panel's scroll; the negative margins undo the panel's `p-5` so the bar spans its width
 * and covers what scrolls beneath it. `-bottom-5` holds whether an engine measures the sticky edge
 * from the padding box or the scrollport — either way the buttons stay visible.
 */
export function ModalFooter({ children }: { children: ReactNode }) {
  return (
    <div className="sticky -bottom-5 z-10 -mx-5 -mb-5 border-t border-border bg-surface px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
      {children}
    </div>
  );
}

/**
 * The part of the screen the on-screen keyboard leaves visible. Android Chrome (since 108) and iOS
 * Safari both open the keyboard OVER the layout viewport — `dvh` and `inset-0` do not shrink — so a
 * bottom sheet sized against them keeps its lower half, Save included, under the keys. Only
 * `visualViewport` reports what is actually visible; the overlay is pinned to it, and a focused
 * field is brought back into the shrunken sheet. Null where the API is missing: `inset-0` stands.
 */
function useVisibleViewport(open: boolean, panel: RefObject<HTMLDivElement | null>) {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!open || !vv) return;
    const update = () => setBox({ top: vv.offsetTop, height: vv.height });
    const onResize = () => {
      update();
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && panel.current?.contains(focused)) {
        // Centre, not «nearest»: nearest parks the field under the sticky footer.
        requestAnimationFrame(() => focused.scrollIntoView({ block: 'center' }));
      }
    };
    update();
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', onResize);
      vv.removeEventListener('scroll', update);
    };
  }, [open, panel]);
  return box;
}
