/**
 * Opens a blob URL that has to be FETCHED first (estimate/act PDFs).
 *
 * `window.open(url)` after an awaited fetch works on Android/desktop, but iOS Safari treats the
 * click's "user activation" as spent by the FIRST `await` in the handler and silently drops the
 * call — no error, no tab. So on iOS the tab must be reserved synchronously, in the click itself,
 * before ANY await — including the ones a handler does before it even fetches (the email gate, the
 * outbox check, saving the act). That is what {@link reservePdfTab} is for: call it on the handler's
 * first line, then `open` it once the blob is ready, or `cancel` it on an early return (review
 * P1-18).
 *
 * In the INSTALLED app on an iPhone a window holding a blob URL comes up blank — the new window does
 * not share the app's context — so there the PDF is handed over as a download instead: iOS shows it
 * in its own viewer, with Share. Off iOS nothing is reserved: the plain open-after-fetch works there,
 * and a blank tab stealing focus while a confirm dialog is up would only get in the way.
 *
 * The blob URL is revoked a minute later — enough for the tab (or the viewer) to load it.
 */
export interface PdfTab {
  open(fetchPdf: () => Promise<{ url: string; revoke: () => void }>, filename?: string): Promise<void>;
  cancel(): void;
}

export function reservePdfTab(): PdfTab {
  const standalone = isIosStandalone();
  const reserved = !standalone && isIos() ? window.open('', '_blank') : null;
  return {
    async open(fetchPdf, filename = 'majstr.pdf') {
      try {
        const { url, revoke } = await fetchPdf();
        if (standalone) {
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.append(a);
          a.click();
          a.remove();
        } else if (reserved) {
          reserved.location.href = url;
        } else {
          window.open(url, '_blank');
        }
        setTimeout(revoke, 60_000);
      } catch (err) {
        // Don't leave a stranded blank tab behind a failed fetch; the error is the caller's to surface.
        reserved?.close();
        throw err;
      }
    },
    cancel() {
      reserved?.close();
    },
  };
}

/** The one-step form, for a handler that has no await before the fetch. */
export async function openPdfTab(
  fetchPdf: () => Promise<{ url: string; revoke: () => void }>,
  filename?: string,
): Promise<void> {
  return reservePdfTab().open(fetchPdf, filename);
}

function isIos(): boolean {
  // iPadOS reports itself as a Mac; a Mac has no touch points.
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isIosStandalone(): boolean {
  return isIos() && (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
