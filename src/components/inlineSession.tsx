import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { closeModalEntry, dropModalEntry, openModalEntry } from '@/lib/modalHistory.ts';

/**
 * What every inline cell does while it is being edited, in one place:
 *
 * - system «Назад» (Android, an iOS edge swipe) CANCELS the cell instead of leaving the screen —
 *   the cell takes a history entry exactly as a `Modal` does (`modalHistory.ts`);
 * - the app going to the background SAVES (`visibilitychange → hidden`), so a phone call in the
 *   middle of typing loses nothing.
 *
 * `commit` / `cancel` are read through a ref, so the latest closure answers.
 */
export function useInlineSession(editing: boolean, commit: () => void, cancel: () => void): void {
  const handlers = useRef({ commit, cancel });
  useLayoutEffect(() => {
    handlers.current = { commit, cancel };
  });

  useEffect(() => {
    if (!editing) return undefined;
    let backed = false;
    const entry = openModalEntry(() => {
      backed = true;
      handlers.current.cancel();
    });
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') handlers.current.commit();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (backed) dropModalEntry(entry);
      else closeModalEntry(entry);
    };
  }, [editing]);
}

/** The attribute every EDITABLE cell's wrapper carries; document order is the «Далі» order —
 *  left to right along the row, then the next row. */
export const INLINE_CELL_ATTR = 'data-inline-cell';

/**
 * Open the editable cell after `from`. Synchronous on purpose: called from inside the tap, so the
 * next input is focused within the same user gesture and the phone keeps its keyboard up.
 */
export function focusNextInlineCell(from: Element | null): boolean {
  if (!from) return false;
  const cells = Array.from(document.querySelectorAll(`[${INLINE_CELL_ATTR}]`));
  const next = cells[cells.indexOf(from) + 1];
  const trigger = next?.querySelector('button');
  if (!trigger) return false;
  trigger.click();
  return true;
}

/**
 * «Далі ↓», pinned just above the on-screen keyboard. The visual viewport is what the keyboard
 * shrinks; the layout viewport is not, so `bottom` is the gap between the two.
 */
export function InlineKeyboardBar({ onNext }: { onNext: () => void }) {
  const { t } = useTranslation();
  const [bottom, setBottom] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const place = () => setBottom(Math.max(0, window.innerHeight - (vv.height + vv.offsetTop)));
    place();
    vv.addEventListener('resize', place);
    vv.addEventListener('scroll', place);
    return () => {
      vv.removeEventListener('resize', place);
      vv.removeEventListener('scroll', place);
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-x-0 z-[65] flex justify-end border-t border-gray-200 bg-gray-50 px-3 py-1.5"
      style={{ bottom }}
    >
      <button
        type="button"
        // Keep the input focused: a press here must not blur (and so commit) before onNext runs.
        onPointerDown={(e) => e.preventDefault()}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onNext}
        className="min-h-[44px] rounded-md px-4 text-sm font-semibold text-orange-700 active:bg-orange-100"
      >
        {t('inline.next')}
      </button>
    </div>,
    document.body,
  );
}
