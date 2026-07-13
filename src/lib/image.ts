/**
 * Downscale an image on the client before upload — the biggest lever on storage
 * and mobile bandwidth. Re-encodes to JPEG at ~2048px longest edge, so a 6 MB
 * phone photo becomes a few hundred KB, invisibly. Fails open: if decoding isn't
 * available (older browser / jsdom in tests) or anything throws, the original file
 * is returned and the server-side size cap remains the guard.
 */
export async function downscaleImage(
  file: File,
  maxEdge = 2048,
  quality = 0.82,
): Promise<File> {
  if (!/^image\/(jpeg|jpg|png|webp)$/.test(file.type)) return file;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= maxEdge) {
      bitmap.close?.();
      return file; // already small enough — don't re-encode
    }
    const scale = maxEdge / longest;
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    );
    if (!blob) return file;
    const name = file.name.replace(/\.(png|webp|jpeg|jpg)$/i, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
