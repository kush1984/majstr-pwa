/**
 * Client-side PDF page selection for the electrical-plan import. Real project sets are
 * dozens of pages (plans, sections, visualisations); sending the whole file risks the model
 * counting the wrong sheet, so the master picks the page(s) and we ship only those.
 *
 * pdf-lib is dynamically imported so it stays out of the initial bundle — it loads only when
 * a master actually extracts a PDF here.
 */

/** Number of pages in a PDF file, or 0 if it can't be read. */
export async function pdfPageCount(file: File): Promise<number> {
  try {
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(await file.arrayBuffer());
    return doc.getPageCount();
  } catch {
    return 0;
  }
}

/**
 * Parse a page-selection string («3», «3-4», «1,3,5», «2-3,7») into a sorted, de-duped list
 * of 1-based page numbers clamped to [1, max]. Empty/invalid → [].
 */
export function parsePageRange(input: string, max: number): number[] {
  const pages = new Set<number>();
  for (const part of input.split(',')) {
    const s = part.trim();
    if (!s) continue;
    const dash = s.match(/^(\d+)\s*-\s*(\d+)$/);
    if (dash) {
      const a = Number(dash[1]);
      const b = Number(dash[2]);
      for (let p = Math.min(a, b); p <= Math.max(a, b); p++) {
        if (p >= 1 && p <= max) pages.add(p);
      }
    } else if (/^\d+$/.test(s)) {
      const p = Number(s);
      if (p >= 1 && p <= max) pages.add(p);
    }
  }
  return [...pages].sort((a, b) => a - b);
}

/**
 * Build a new PDF File containing only the given 1-based pages, preserving order. Returns the
 * original file untouched when the selection covers every page (or is empty).
 */
export async function extractPdfPages(file: File, pages: number[]): Promise<File> {
  const { PDFDocument } = await import('pdf-lib');
  const src = await PDFDocument.load(await file.arrayBuffer());
  const total = src.getPageCount();
  const indices = pages.map((p) => p - 1).filter((i) => i >= 0 && i < total);
  if (indices.length === 0 || indices.length === total) return file;

  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, indices);
  copied.forEach((pg) => out.addPage(pg));
  const bytes = await out.save();
  return new File([new Uint8Array(bytes)], file.name, { type: 'application/pdf' });
}
