import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn.ts';
import {
  editableInlineNumber,
  formatInlineNumber,
  parseInlineNumber,
  sameInlineNumber,
  type InlineNumberKind,
} from '@/lib/inlineEdit.ts';
import { INLINE_CELL_ATTR, InlineKeyboardBar, focusNextInlineCell, useInlineSession } from './inlineSession.tsx';

export interface InlineNumberCellProps {
  value: number;
  kind: InlineNumberKind;
  /** «Кількість, Укладання плитки 300×600» — the field AND the row, for a screen reader. */
  ariaLabel: string;
  /** Called only with a NEW, valid value. The cell leaves edit mode at once (optimistic). */
  onCommit: (value: number) => void;
  /** Plain text, no frame, no tap — a signed estimate, an addendum line, a read-only screen. */
  readOnly?: boolean;
  /** Overrides the shown text (e.g. «672,51 ₴»); the edit field always starts from the bare number. */
  display?: ReactNode;
  className?: string;
}

/**
 * A number the master taps and types, the way he would in a spreadsheet.
 *
 * Saves on blur, Enter, «Далі ↓» and the app going to the background; cancels on Esc and system
 * «Назад». Empty is 0; a minus, a letter or too many decimals turns the frame red and saves nothing.
 * Enter and «Далі ↓» move on to the next editable cell — along the row, then the next row.
 */
export function InlineNumberCell({
  value, kind, ariaLabel, onCommit, readOnly = false, display, className,
}: InlineNumberCellProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const wrapper = useRef<HTMLSpanElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // The blur that follows Enter / «Далі» / Esc must not save a second time.
  const open = useRef(false);

  const shown = display ?? formatInlineNumber(value, kind);

  useLayoutEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);

  /** Answers whether the cell may close: an unreadable figure keeps it open. */
  const commit = (): boolean => {
    if (!open.current) return true;
    const parsed = parseInlineNumber(text, kind);
    if (!parsed.ok) {
      setInvalid(true);
      return false;
    }
    open.current = false;
    setEditing(false);
    setInvalid(false);
    if (!sameInlineNumber(parsed.value, value, kind)) onCommit(parsed.value);
    return true;
  };
  const cancel = () => {
    open.current = false;
    setEditing(false);
    setInvalid(false);
  };
  const next = () => {
    if (commit()) focusNextInlineCell(wrapper.current);
  };

  useInlineSession(editing, () => {
    // Leaving the app with garbage in the field: nothing to save, so put the old value back.
    if (!commit()) cancel();
  }, cancel);

  if (readOnly) {
    return <span className={cn('tabular-nums', className)}>{shown}</span>;
  }

  return (
    <span ref={wrapper} {...{ [INLINE_CELL_ATTR]: '' }} className={cn('inline-flex', className)}>
      {editing ? (
        <>
          <input
            ref={input}
            type="text"
            inputMode="decimal"
            enterKeyHint="next"
            autoComplete="off"
            aria-label={ariaLabel}
            aria-invalid={invalid || undefined}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setInvalid(false);
            }}
            onBlur={() => {
              if (!commit()) cancel();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                next();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
              }
            }}
            className={cn(
              'min-h-[44px] w-full min-w-[4.5rem] rounded-md border-2 bg-white px-2 text-right tabular-nums outline-none',
              invalid ? 'border-red-500' : 'border-orange-500',
            )}
          />
          <InlineKeyboardBar onNext={next} />
        </>
      ) : (
        <button
          type="button"
          aria-label={ariaLabel}
          onClick={() => {
            setText(editableInlineNumber(value, kind));
            setInvalid(false);
            open.current = true;
            setEditing(true);
          }}
          className="min-h-[44px] w-full min-w-[4.5rem] rounded-md border border-gray-200 px-2 text-right tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500 active:bg-orange-50"
        >
          {shown}
        </button>
      )}
    </span>
  );
}
