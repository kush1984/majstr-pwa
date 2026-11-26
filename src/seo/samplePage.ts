import './seo.css';
import { captureFirstTouch, captureRefFromUrl, captureUtmFromUrl } from '@/lib/referral.ts';
import { trackPage } from '@/lib/visit.ts';

// The sample is printed at build time; the only thing this page does is remember where the visitor
// came from, like every other first page (V178), so a master who registers later is not counted as «direct».
captureRefFromUrl(window.location.search);
captureUtmFromUrl(window.location.search);
captureFirstTouch(document.referrer, window.location.pathname, window.location.hostname);
trackPage(window.location.pathname);

/**
 * The sign-up bar pinned to the bottom of a phone (only the pages that carry one — the sample estimate):
 * shown once the reader has reached the table, hidden again as the final CTA comes into view — and while
 * the button right under the table is on screen, so one screen never shows the same offer twice. On a wide
 * screen the stylesheet keeps it hidden whatever this says.
 */
export function stickyCtaShown(tableTop: number, finalTop: number, viewport: number,
                               afterTable?: { top: number; bottom: number }): boolean {
  const afterTableInView = afterTable !== undefined && afterTable.top < viewport && afterTable.bottom > 0;
  return tableTop < viewport / 2 && finalTop > viewport && !afterTableInView;
}

function installStickyCta(): void {
  const bar = document.querySelector<HTMLElement>('[data-sticky-cta]');
  // The TABLE, not the document's head: on a phone the head is already on the first screen.
  const table = document.querySelector<HTMLElement>('.seo-doc table');
  const final = document.querySelector<HTMLElement>('.seo-cta');
  const afterTable = document.querySelector<HTMLElement>('.seo-after-table');
  if (!bar || !table || !final) return;
  let queued = false;
  const update = () => {
    queued = false;
    const after = afterTable?.getBoundingClientRect();
    bar.hidden = !stickyCtaShown(table.getBoundingClientRect().top, final.getBoundingClientRect().top, window.innerHeight,
      after ? { top: after.top, bottom: after.bottom } : undefined);
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  update();
}
installStickyCta();
