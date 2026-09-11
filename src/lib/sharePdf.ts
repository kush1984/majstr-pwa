import { isHandheld } from './deviceInput.ts';

/**
 * Hands a fetched PDF to the phone's own share sheet — Viber, Telegram, WhatsApp, mail — so the
 * master can send a document to the client without leaving the screen he is on.
 *
 * <p>Three rungs, each a real device behaviour rather than defensive padding:</p>
 * <ol>
 *   <li><b>The share sheet — on a HANDHELD only.</b> `canShare({ files })` alone is not enough to
 *       ask: <b>Windows Chrome answers it `true`</b> and then opens the OS share sheet, which offers
 *       a handful of UWP targets, no mail client and a «Copy» that copies nothing (verified
 *       2026-09-11 on Windows 11) — a dead end where the browser's own download is what the master
 *       actually wants. So the sheet is offered only where it is the native way to send a file, and
 *       `canShare` is still asked there because a browser can have `navigator.share` and refuse
 *       files, and calling `share` then throws instead of falling back.</li>
 *   <li><b>A new tab.</b> Every desktop, and any phone whose browser has no file sharing: the PDF
 *       opens in the browser's viewer, which has download, print and a real file to attach to mail.
 *       Note that the fetch already happened, so iOS may have spent the click's user activation —
 *       hence the third rung rather than a bare `window.open`.</li>
 *   <li><b>A download link.</b> When even the tab is blocked by the popup blocker.</li>
 * </ol>
 *
 * <p><b>An abort is a success.</b> Closing the share sheet rejects with `AbortError` — the master
 * changed his mind, and answering that with an error toast (or, worse, a second attempt in a new
 * tab) makes cancelling look broken.</p>
 *
 * <p>The object URL is revoked a minute later, the same lifetime {@link openPdfTab} uses.</p>
 */
export async function sharePdf(blob: Blob, fileName: string, title?: string): Promise<void> {
  const file = new File([blob], fileName, { type: 'application/pdf' });

  if (
    isHandheld() &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (err) {
      // Cancelled by the master — done, not failed.
      if (err instanceof Error && err.name === 'AbortError') return;
      // Anything else (a share target that refused the file) still deserves the fallback.
    }
  }

  const url = URL.createObjectURL(blob);
  if (!window.open(url, '_blank')) {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
