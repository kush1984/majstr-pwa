/**
 * Bring a just-added / just-edited row on screen.
 *
 * Two things make the obvious one-liner unreliable, both found by testing the real app in Chrome on
 * Windows (2026-08-23):
 *
 * 1. **`behavior: 'smooth'` can be a complete no-op.** With the browser's "Smooth Scrolling" setting
 *    off, `scrollIntoView({behavior:'smooth'})`, `window.scrollTo({behavior:'smooth'})` and CSS
 *    `scroll-behavior: smooth` all refuse to move the page at all — `scrollY` never changes, and
 *    `prefers-reduced-motion` reads `false`, so there is nothing to feature-detect up front. Only the
 *    instant form works. So the animation must never be the ONLY way the row gets on screen: ask for
 *    smooth, then check whether anything actually moved and jump instantly if it did not.
 * 2. **An open `Modal` freezes `<body>` with `position: fixed`** for its iOS-safe scroll lock, and
 *    while it is frozen nothing can scroll. The caller must not burn its scroll target in that state
 *    — see {@link bodyScrollLocked}.
 *
 * A row is also not always the page's to move: a list with its own `overflow-y` clips its rows, and
 * inside a modal that container is the ONLY thing that can scroll at all. So both checks — "did it
 * move" and "is it already visible" — are asked of whatever actually scrolls, not of the window.
 */

/** How long to give a smooth scroll before deciding it is not going to happen. */
const SMOOTH_GRACE_MS = 250;

/**
 * True while a {@link Modal} holds the page frozen for its scroll lock. Reads the same signal the
 * Modal itself uses to decide whether it is the outermost lock (`body.style.position === 'fixed'`),
 * so the two cannot drift apart — change one and change the other.
 */
export const bodyScrollLocked = () => document.body.style.position === 'fixed';

/** The nearest ancestor that actually scrolls, or `null` when that is the page itself. */
function scrollBox(row: Element): Element | null {
  for (let el = row.parentElement; el; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight) return el;
  }
  return null;
}

/** Where the thing that scrolls is right now. The page keeps reading `window.scrollY`: under a
 *  modal's lock `documentElement.scrollTop` is pinned to 0 and would report "nothing moved". */
const scrollPos = (box: Element | null) => (box ? box.scrollTop : window.scrollY);

const fullyVisible = (row: Element, box: Element | null): boolean => {
  const rect = row.getBoundingClientRect();
  if (!box) return rect.top >= 0 && rect.bottom <= window.innerHeight;
  const bounds = box.getBoundingClientRect();
  return rect.top >= bounds.top && rect.bottom <= bounds.bottom;
};

export function scrollRowIntoView(row: Element): void {
  const box = scrollBox(row);
  const before = scrollPos(box);
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.setTimeout(() => {
    if (scrollPos(box) !== before) return; // the animation is running — leave it alone
    if (fullyVisible(row, box)) return;
    row.scrollIntoView({ block: 'center' });
  }, SMOOTH_GRACE_MS);
}
