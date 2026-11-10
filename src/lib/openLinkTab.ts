/**
 * A new tab for a URL the server has to hand out first (the client preview pass).
 *
 * Reserved in the tap itself, on every platform: iOS Safari drops a `window.open` that comes after
 * an `await` (see `openPdfTab.ts`), and a desktop popup blocker may too once the fetch is slow.
 * Unlike a PDF there is no dialog between the tap and the page, so a blank tab for the length of
 * one request stands in nobody's way. The opened page gets no `opener`: it is the client's portal,
 * on another origin, and has no business reaching back into the app.
 */
export interface LinkTab {
  go(url: string): void;
  cancel(): void;
}

export function reserveLinkTab(): LinkTab {
  const reserved = window.open('', '_blank');
  if (reserved) reserved.opener = null;
  return {
    go(url) {
      if (reserved && !reserved.closed) {
        reserved.location.href = url;
      } else {
        window.open(url, '_blank', 'noopener');
      }
    },
    cancel() {
      reserved?.close();
    },
  };
}
