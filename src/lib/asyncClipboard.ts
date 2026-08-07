/**
 * Copies a link the server has to mint first (publish a portal, generate a message-link token, …).
 *
 * `navigator.clipboard.writeText(await mint())` works on Android/desktop, but iOS Safari treats the
 * click's "user activation" as spent by the `await` and silently refuses the write — the link
 * publishes fine, the copy just does nothing, no error surfaced. `ClipboardItem` accepts a
 * `Promise<Blob>` as a representation; WebKit (and modern Chrome) resolve it internally *after* the
 * write call has already registered against the still-active click, so this keeps the exact same
 * outcome everywhere while fixing iOS. Where the async form isn't available (old Firefox,
 * non-secure context, no `ClipboardItem`), it falls back to the original sequential write unchanged.
 */
export async function copyWhenReady(mint: () => Promise<string>): Promise<{ copied: boolean; value: string }> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    return { copied: false, value: await mint() };
  }

  if (typeof ClipboardItem !== 'function' || !navigator.clipboard.write) {
    const value = await mint();
    const copied = await navigator.clipboard.writeText(value).then(() => true, () => false);
    return { copied, value };
  }

  // Started synchronously — still within the click's user activation — and only awaited below,
  // which (unlike an `await` BEFORE this call) does not retroactively spend that activation.
  const mintPromise = mint();
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ 'text/plain': mintPromise.then((value) => new Blob([value], { type: 'text/plain' })) }),
    ]);
    return { copied: true, value: await mintPromise };
  } catch {
    // ClipboardItem write refused (permission / unsupported representation) — mint() may still
    // have succeeded. Fall back to the plain write for that value; a genuine mint() failure
    // propagates as-is rather than being swallowed as "copy failed".
    const value = await mintPromise;
    const copied = await navigator.clipboard.writeText(value).then(() => true, () => false);
    return { copied, value };
  }
}
