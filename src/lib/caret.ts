/**
 * Where the caret lands when the master taps a NAME to edit it: at the end of the word under his
 * finger, not at the end of the whole name — he tapped the word he means to fix.
 */

/** A space or a punctuation mark ends a word. An apostrophe does not («м'яка», «обʼєкт»). */
const WORD_BREAK = /[\s,.;:!?()[\]{}/\\×—–«»"]/u;

/**
 * The caret offset moved forward to the end of the word it sits in. On a break character (a space,
 * a bracket…) or at the very end it stays put.
 */
export function wordEndAt(text: string, offset: number): number {
  let i = Math.max(0, Math.min(offset, text.length));
  while (i < text.length && !WORD_BREAK.test(text.charAt(i))) i += 1;
  return i;
}

/** The word around the offset as [start, end] — what a double tap selects. */
export function wordAt(text: string, offset: number): [number, number] {
  const end = wordEndAt(text, offset);
  let start = Math.min(offset, end);
  while (start > 0 && !WORD_BREAK.test(text.charAt(start - 1))) start -= 1;
  return [start, end];
}

interface CaretDocument {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
}

/**
 * The text offset inside `container` under the point (x, y), or null when the browser cannot tell
 * or the point is over something else. `caretPositionFromPoint` is the standard (Chrome 128+,
 * Firefox, Safari 18.4+); `caretRangeFromPoint` covers the older WebKit/Blink.
 */
export function caretOffsetAt(container: Element, x: number, y: number): number | null {
  const doc: CaretDocument = document;
  let node: Node | null = null;
  let offset = 0;
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position) {
    node = position.offsetNode;
    offset = position.offset;
  } else {
    const range = doc.caretRangeFromPoint?.(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE || !container.contains(node)) return null;

  // The name may be split across several text nodes; count the ones before the hit.
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let before = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n === node) return before + offset;
    before += n.textContent?.length ?? 0;
  }
  return null;
}
