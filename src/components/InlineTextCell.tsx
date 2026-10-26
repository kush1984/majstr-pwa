import { useLayoutEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn.ts';
import { normalizeInlineText } from '@/lib/inlineEdit.ts';
import { INLINE_CELL_ATTR, useInlineSession } from './inlineSession.tsx';

export interface InlineTextCellProps {
  value: string;
  /** «Назва, Укладання плитки 300×600». */
  ariaLabel: string;
  /** Called only with a NEW, non-empty, trimmed value. */
  onCommit: (value: string) => void;
  readOnly?: boolean;
  maxLength?: number;
  /** What the row shows in place of the bare text (a number prefix, a badge…). */
  display?: ReactNode;
  className?: string;
}

/**
 * A name the master taps and retypes. Opens a field across the row's full width with «Готово» and
 * «Скасувати» under it. Saves on blur, Enter, «Готово» and the app going to the background;
 * cancels on Esc, system «Назад» and «Скасувати». An empty name is not saved — the old one comes
 * back, without an error.
 */
export function InlineTextCell({
  value, ariaLabel, onCommit, readOnly = false, maxLength = 255, display, className,
}: InlineTextCellProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const open = useRef(false);

  useLayoutEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);

  const commit = () => {
    if (!open.current) return;
    open.current = false;
    setEditing(false);
    const next = normalizeInlineText(text);
    if (next !== null && next !== value) onCommit(next);
  };
  const cancel = () => {
    open.current = false;
    setEditing(false);
  };

  useInlineSession(editing, commit, cancel);

  if (readOnly) {
    return <span className={cn('break-words', className)}>{display ?? value}</span>;
  }

  if (!editing) {
    return (
      <span {...{ [INLINE_CELL_ATTR]: '' }} className={cn('block', className)}>
        <button
          type="button"
          aria-label={ariaLabel}
          onClick={() => {
            setText(value);
            open.current = true;
            setEditing(true);
          }}
          className="min-h-[44px] w-full rounded-md border border-gray-200 px-2 py-1 text-left break-words focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500 active:bg-orange-50"
        >
          {display ?? value}
        </button>
      </span>
    );
  }

  // A press on either button must not blur the field first — the blur would save before «Скасувати».
  const keepFocus = (e: SyntheticEvent) => e.preventDefault();

  return (
    <span {...{ [INLINE_CELL_ATTR]: '' }} className={cn('block w-full', className)}>
      <input
        ref={input}
        type="text"
        enterKeyHint="done"
        autoComplete="off"
        maxLength={maxLength}
        aria-label={ariaLabel}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
        className="min-h-[44px] w-full rounded-md border-2 border-orange-500 bg-white px-2 outline-none"
      />
      <span className="mt-1 flex justify-end gap-2">
        <button
          type="button"
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
          onClick={cancel}
          className="min-h-[44px] rounded-md px-3 text-sm text-gray-700 active:bg-gray-100"
        >
          {t('inline.cancel')}
        </button>
        <button
          type="button"
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
          onClick={commit}
          className="min-h-[44px] rounded-md bg-orange-600 px-4 text-sm font-semibold text-white active:bg-orange-700"
        >
          {t('inline.done')}
        </button>
      </span>
    </span>
  );
}
