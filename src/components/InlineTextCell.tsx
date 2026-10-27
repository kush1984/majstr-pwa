import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn.ts';
import { caretOffsetAt, wordAt, wordEndAt } from '@/lib/caret.ts';
import { normalizeInlineText } from '@/lib/inlineEdit.ts';
import {
  INLINE_CELL_ATTR, InlineKeyHint, InlineKeyboardBar, isFinePointer, useInlineSession,
} from './inlineSession.tsx';

export interface InlineTextCellProps {
  value: string;
  /** «Назва, Укладання плитки 300×600». */
  ariaLabel: string;
  /** Called only with a NEW, non-empty, trimmed value. */
  onCommit: (value: string) => void;
  readOnly?: boolean;
  maxLength?: number;
  className?: string;
}

/** The box both states share, so the text does not move when the field opens over it. */
const BOX = 'block min-h-[44px] break-words px-1.5 py-3';

/** A second tap this soon after the first is a double tap. */
const DOUBLE_TAP_MS = 400;

/** iOS zooms the page into any field under 16 px — see `fieldStyle`. */
const MIN_FIELD_PX = 16;

/**
 * The field's geometry, read off the text it replaces. A row's name is 14 px, a field under 16 px
 * makes iOS zoom the whole page, and a field at 16 px would re-wrap the name and jump. So the
 * textarea is set at 16 px with every length scaled by 16/14 and then shrunk back with a transform:
 * on screen it is the same size, the same line breaks, the same padding as the text it covers.
 */
function fieldStyle(text: Element): CSSProperties {
  const cs = window.getComputedStyle(text);
  const size = parseFloat(cs.fontSize) || MIN_FIELD_PX;
  const scale = Math.min(1, size / MIN_FIELD_PX);
  const px = (v: string) => `${(parseFloat(v) || 0) / scale}px`;
  const lineHeight = parseFloat(cs.lineHeight);
  return {
    fontSize: `${size / scale}px`,
    fontWeight: cs.fontWeight,
    lineHeight: Number.isFinite(lineHeight) ? `${lineHeight / scale}px` : 'normal',
    padding: `${px(cs.paddingTop)} ${px(cs.paddingRight)} ${px(cs.paddingBottom)} ${px(cs.paddingLeft)}`,
    width: `${100 / scale}%`,
    height: `${100 / scale}%`,
    transform: scale === 1 ? undefined : `scale(${scale})`,
    transformOrigin: '0 0',
  };
}

/**
 * A name the master taps and retypes, in place.
 *
 * At rest it is plain text — no frame, no underline: a name is obviously something to tap. A tap
 * opens a field exactly over the text (same font, same wrap — see `fieldStyle`) with the caret at
 * the end of the word under the finger, because that is the word he means to fix; selecting the
 * whole name would let the first keystroke wipe it. From the keyboard (Tab, then Enter) the caret
 * goes to the end. A long press still selects text the way the phone always does.
 *
 * Saves on blur, Enter, «Готово» and the app going to the background; cancels on Esc, system
 * «Назад» and «Скасувати». An empty name is not saved — the old one comes back, without an error.
 * On a phone «Скасувати · Готово» sit above the keyboard; with a mouse a quiet hint names the keys.
 */
export function InlineTextCell({
  value, ariaLabel, onCommit, readOnly = false, maxLength = 255, className,
}: InlineTextCellProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [style, setStyle] = useState<CSSProperties>({});
  const [fine, setFine] = useState(false);
  const shown = useRef<HTMLSpanElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const open = useRef(false);
  // The selection the field opens with: [n, n] for a tap, the word for a double tap.
  const caret = useRef<[number, number]>([0, 0]);
  // When a TAP opened the field: the second tap of a double tap lands on the new textarea, where
  // the browser's click count starts over — so «select the word» is done by hand for it.
  const tappedAt = useRef(0);

  useLayoutEffect(() => {
    const field = input.current;
    if (!editing || !field) return undefined;
    const place = () => field.setSelectionRange(caret.current[0], caret.current[1]);
    field.focus();
    place();
    // iOS moves the caret again after focusing; put it back on the next frame.
    const frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
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

  const start = (at: number) => {
    if (shown.current) setStyle(fieldStyle(shown.current));
    caret.current = [at, at];
    setText(value);
    setFine(isFinePointer());
    open.current = true;
    setEditing(true);
  };

  const onTap = (e: MouseEvent<HTMLSpanElement>) => {
    // A drag or a long press that selected part of the name is the master copying it, not editing.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && shown.current?.contains(selection.anchorNode)) return;
    // detail 0 = a click with no pointer (Enter on the row, «Далі» opening it): the end of the name.
    const at = e.detail === 0 || !shown.current ? null : caretOffsetAt(shown.current, e.clientX, e.clientY);
    tappedAt.current = e.detail === 0 ? 0 : performance.now();
    start(at === null ? value.length : wordEndAt(value, at));
  };

  const onFieldClick = () => {
    const field = input.current;
    if (!field || performance.now() - tappedAt.current > DOUBLE_TAP_MS) return;
    tappedAt.current = 0;
    caret.current = wordAt(field.value, field.selectionStart);
    field.setSelectionRange(caret.current[0], caret.current[1]);
  };

  if (readOnly) {
    return <span className={cn('break-words', className)}>{value}</span>;
  }

  if (!editing) {
    return (
      <span {...{ [INLINE_CELL_ATTR]: '' }} className={cn('block', className)}>
        <span
          ref={shown}
          role="button"
          tabIndex={0}
          aria-label={ariaLabel}
          onClick={onTap}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              start(value.length);
            }
          }}
          // `select-text` + the default callout undo the base rule for role="button": the name is
          // TEXT, and a long press on it should select a word like anywhere else on the phone.
          className={cn(
            BOX,
            'cursor-text select-text rounded-[5px] [-webkit-touch-callout:default] hover:bg-cell-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand',
          )}
        >
          {value}
        </span>
      </span>
    );
  }

  const done = () => commit();

  return (
    <span {...{ [INLINE_CELL_ATTR]: '' }} className={cn('block w-full', className)}>
      <span data-inline-editing="" className="relative block rounded-[7px] bg-white shadow-sm ring-2 ring-brand">
        {/* The sizer: the same text in the same box, invisible, so the field grows a line as the
            name wraps without measuring anything. The zero-width space keeps an empty one tall. */}
        <span aria-hidden className={cn(BOX, 'invisible whitespace-pre-wrap')}>{text}{'​'}</span>
        <textarea
          ref={input}
          rows={1}
          enterKeyHint="done"
          autoComplete="off"
          maxLength={maxLength}
          aria-label={ariaLabel}
          value={text}
          // A name is one line: a pasted line break becomes a space.
          onChange={(e) => setText(e.target.value.replace(/\r?\n/g, ' '))}
          onClick={onFieldClick}
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
          style={style}
          className="absolute left-0 top-0 m-0 block resize-none overflow-hidden whitespace-pre-wrap break-words border-0 bg-transparent outline-none [color:inherit] [font-family:inherit] [letter-spacing:inherit]"
        />
      </span>
      {fine ? (
        <InlineKeyHint />
      ) : (
        <InlineKeyboardBar
          actions={[
            { label: t('inline.cancel'), onClick: cancel },
            { label: t('inline.done'), onClick: done, primary: true },
          ]}
        />
      )}
    </span>
  );
}
