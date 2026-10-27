import { useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react';
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
  // A number opens from a <button>; a name from its text, a `role="button"` span (see InlineTextCell).
  const trigger = next?.querySelector<HTMLElement>('button, [role="button"]');
  if (!trigger) return false;
  trigger.click();
  return true;
}

/**
 * A mouse and a keyboard, not a finger: Enter / Esc / Tab are there, so the open cell shows a quiet
 * hint instead of the buttons a phone needs above its on-screen keyboard. Read once per open cell.
 */
export function isFinePointer(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
}

export interface InlineBarAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

/** The desktop hint under an open cell: «Enter — зберегти · Esc — скасувати». */
export function InlineKeyHint({ withTab = false, className, ref }: {
  withTab?: boolean;
  className?: string;
  ref?: Ref<HTMLSpanElement>;
}) {
  const { t } = useTranslation();
  return (
    <span ref={ref} className={className ?? 'mt-1 block text-[11px] leading-tight text-faint'}>
      {withTab ? t('inline.keysWithTab') : t('inline.keys')}
    </span>
  );
}

/**
 * The actions of the open cell («Далі ↓», or «Скасувати» · «Готово» for a name), pinned just above
 * the on-screen keyboard. The visual viewport is what the keyboard shrinks; the layout viewport is
 * not, so `bottom` is the gap between the two.
 */
export function InlineKeyboardBar({ actions }: { actions: InlineBarAction[] }) {
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
      className="fixed inset-x-0 z-[65] flex justify-end gap-2 border-t border-gray-200 bg-gray-50 px-3 py-1.5"
      style={{ bottom }}
    >
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          // Keep the field focused: a press here must not blur (and so commit) before onClick runs.
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={a.onClick}
          className={a.primary
            ? 'min-h-[44px] rounded-md px-4 text-sm font-semibold text-orange-700 active:bg-orange-100'
            : 'min-h-[44px] rounded-md px-3 text-sm text-gray-700 active:bg-gray-100'}
        >
          {a.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
