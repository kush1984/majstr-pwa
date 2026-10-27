import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn.ts';
import {
  editableInlineNumber,
  formatInlineNumber,
  parseInlineNumber,
  sameInlineNumber,
  type InlineNumberKind,
} from '@/lib/inlineEdit.ts';
import {
  INLINE_CELL_ATTR, InlineKeyHint, InlineKeyboardBar, focusNextInlineCell, isFinePointer, useInlineSession,
} from './inlineSession.tsx';

export interface InlineNumberCellProps {
  value: number;
  kind: InlineNumberKind;
  /** «Кількість, Укладання плитки 300×600» — the field AND the row, for a screen reader. */
  ariaLabel: string;
  /** Called only with a NEW, valid value. The cell leaves edit mode at once (optimistic). */
  onCommit: (value: number) => void;
  /** Every keystroke's reading of the field (null = unreadable), and null again when it closes —
   *  what lets a row recompute its sum while the master is still typing. */
  onDraft?: (value: number | null) => void;
  /** Plain text, no underline, no tap — a signed estimate, an addendum line, a read-only screen. */
  readOnly?: boolean;
  /** Overrides the shown text (e.g. «672,51 ₴»); the edit field always starts from the bare number. */
  display?: ReactNode;
  /** `warn` — the value is missing and wanted («к-сть?»); `dim` — a figure still being typed elsewhere. */
  tone?: 'default' | 'warn' | 'dim';
  className?: string;
}

/**
 * A number the master taps and types, the way he would in a spreadsheet.
 *
 * At rest it is plain text with a dotted underline — the row reads like a document, not a form;
 * only the open field gets a frame. Saves on blur, Enter, «Далі ↓» / Tab and the app going to the
 * background; cancels on Esc and system «Назад». Empty is 0; a minus, a letter or too many decimals
 * turns the frame red and saves nothing. Enter, «Далі ↓» and Tab move on to the next editable cell
 * — along the row, then the next row.
 */
export function InlineNumberCell({
  value, kind, ariaLabel, onCommit, onDraft, readOnly = false, display, tone = 'default', className,
}: InlineNumberCellProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [fine, setFine] = useState(false);
  // The open field takes the width of the number it replaces, so nothing else on the row moves.
  const [width, setWidth] = useState<number | null>(null);
  // The hint grows toward the middle of the screen, never off its edge.
  const [hintRight, setHintRight] = useState(true);
  const wrapper = useRef<HTMLSpanElement>(null);
  const hint = useRef<HTMLSpanElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // The blur that follows Enter / «Далі» / Esc must not save a second time.
  const open = useRef(false);

  const shown = display ?? formatInlineNumber(value, kind);

  useLayoutEffect(() => {
    if (editing) {
      input.current?.focus();
      // A number is replaced, not amended: the whole value is selected so the first digit overwrites it.
      input.current?.select();
    }
  }, [editing]);

  // The key hint is wider than a narrow cell: nudge it back inside the screen if it ran off an edge.
  useLayoutEffect(() => {
    const el = hint.current;
    if (!editing || !el) return;
    const box = el.getBoundingClientRect();
    const gutter = 8;
    const shift = box.left < gutter ? gutter - box.left
      : box.right > window.innerWidth - gutter ? window.innerWidth - gutter - box.right : 0;
    if (shift !== 0) el.style.transform = `translateX(${shift}px)`;
  }, [editing, fine]);

  const close = () => {
    open.current = false;
    setEditing(false);
    setInvalid(false);
    onDraft?.(null);
  };

  /** Answers whether the cell may close: an unreadable figure keeps it open. */
  const commit = (): boolean => {
    if (!open.current) return true;
    const parsed = parseInlineNumber(text, kind);
    if (!parsed.ok) {
      setInvalid(true);
      return false;
    }
    close();
    if (!sameInlineNumber(parsed.value, value, kind)) onCommit(parsed.value);
    return true;
  };
  const next = () => {
    if (commit()) focusNextInlineCell(wrapper.current);
  };

  useInlineSession(editing, () => {
    // Leaving the app with garbage in the field: nothing to save, so put the old value back.
    if (!commit()) close();
  }, close);

  if (readOnly) {
    return <span className={cn('tabular-nums', className)}>{shown}</span>;
  }

  return (
    <span ref={wrapper} {...{ [INLINE_CELL_ATTR]: '' }} className={cn('relative inline-flex', className)}>
      {editing ? (
        <span data-inline-editing="" className="block">
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
              const parsed = parseInlineNumber(e.target.value, kind);
              onDraft?.(parsed.ok ? parsed.value : null);
            }}
            onBlur={() => {
              if (!commit()) close();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
                e.preventDefault();
                next();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                close();
              }
            }}
            style={width === null ? undefined : { width }}
            className={cn(
              'min-h-[44px] w-[5rem] rounded-[7px] border-0 bg-white px-2 text-right tabular-nums shadow-sm outline-none ring-2',
              invalid ? 'ring-red-500' : 'ring-brand',
            )}
          />
          {fine ? (
            // Absolute, so the hint never pushes the row below it around.
            <InlineKeyHint
              ref={hint}
              withTab
              className={cn(
                'absolute top-full z-10 mt-1 whitespace-nowrap rounded bg-white px-1.5 py-0.5 text-[11px] text-faint shadow-sm',
                hintRight ? 'right-0' : 'left-0',
              )}
            />
          ) : (
            <InlineKeyboardBar actions={[{ label: t('inline.next'), onClick: next, primary: true }]} />
          )}
        </span>
      ) : (
        <button
          type="button"
          aria-label={ariaLabel}
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            setWidth(box.width > 0 ? Math.max(box.width, 56) : null);
            setHintRight(box.left + box.width / 2 > window.innerWidth / 2);
            setText(editableInlineNumber(value, kind));
            setInvalid(false);
            setFine(isFinePointer());
            open.current = true;
            setEditing(true);
          }}
          className={cn(
            'group min-h-[44px] min-w-[2.75rem] rounded-[5px] px-1 text-right tabular-nums hover:bg-cell-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand active:bg-cell-hover',
            tone === 'warn' && 'text-brand-dark',
            tone === 'dim' && 'text-faint',
          )}
        >
          <span
            className={cn(
              'border-b-[1.5px] border-dotted group-hover:border-transparent',
              tone === 'warn' ? 'border-brand' : 'border-cell-dot',
            )}
          >
            {shown}
          </span>
        </button>
      )}
    </span>
  );
}
