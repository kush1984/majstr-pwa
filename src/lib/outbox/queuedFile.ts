/**
 * A file waiting in the outbox.
 *
 * <p><b>Bytes, not a `Blob`.</b> `Blob` is structured-cloneable and IndexedDB is specified to store
 * it, so queueing the `File` itself looks like the obvious move. It is not: Safari has a long
 * history of Blob-in-IndexedDB bugs (the exact browser a Ukrainian master on an iPhone is using),
 * `fake-indexeddb` does not model blob storage faithfully enough to pin the round trip in a test,
 * and — the reason that settles it — an `ArrayBuffer` has a `byteLength`, so the queue can say how
 * much of the master's storage it is holding. A quota story needs a number.</p>
 *
 * <p>Downscale BEFORE calling this ({@link downscaleImage}): what lands in IndexedDB should be the
 * few hundred KB that would have been uploaded, not the 6 MB the camera produced.</p>
 */
export interface QueuedFile {
  bytes: ArrayBuffer;
  fileName: string;
  mimeType: string;
}

export async function toQueuedFile(file: File): Promise<QueuedFile> {
  return {
    bytes: await file.arrayBuffer(),
    fileName: file.name || 'photo.jpg',
    // A camera file occasionally arrives with an empty type; the server sniffs the content anyway,
    // but multipart with no content type is worth avoiding.
    mimeType: file.type || 'image/jpeg',
  };
}

export function fromQueuedFile(q: QueuedFile): File {
  return new File([q.bytes], q.fileName, { type: q.mimeType });
}

/** For the UI: an object URL the caller must revoke. */
export function queuedFileUrl(q: QueuedFile): string {
  return URL.createObjectURL(new Blob([q.bytes], { type: q.mimeType }));
}
