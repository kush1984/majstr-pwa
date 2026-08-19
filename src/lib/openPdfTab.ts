/**
 * Opens a blob URL that has to be FETCHED first (estimate/act PDFs) in a new tab.
 *
 * `window.open(url)` after an awaited fetch works on Android/desktop, but iOS Safari treats the
 * click's "user activation" as spent by the `await` and silently drops the call — no error, no tab
 * (the same WebKit rule `copyWhenReady` works around for the clipboard). So the tab is reserved
 * synchronously, BEFORE any await, and its location is filled in once the blob is ready. `reserved`
 * is null when even the blank open was blocked — then it falls back to the plain open-after-fetch
 * attempt, same behaviour as before the fix.
 *
 * The blob URL is revoked a minute later — enough for the tab to load it, and the same lifetime the
 * pre-helper call sites used.
 */
export async function openPdfTab(fetchPdf: () => Promise<{ url: string; revoke: () => void }>): Promise<void> {
  const reserved = window.open('', '_blank');
  try {
    const { url, revoke } = await fetchPdf();
    if (reserved) {
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
}
