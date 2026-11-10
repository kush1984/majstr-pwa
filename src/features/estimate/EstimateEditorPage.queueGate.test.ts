import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Review P-62. The PDF and the share link are rendered by the SERVER from what it holds, so an
 * edit still sitting in the phone's queue was simply missing from what the client received — the act
 * learned this in P-37, the estimate had not. And a signature landing while a sheet was open left the
 * master typing into a form every save of which the server refuses.
 *
 * Asserted against the source, the way the project guards rules whose failure mode is silent: the
 * page is too large to render here, and «nothing happens» is the bug.
 */
const source = readFileSync(resolve(process.cwd(), 'src/features/estimate/EstimateEditorPage.tsx'), 'utf8');

function body(name: string): string {
  const start = source.indexOf(`const ${name} = async (`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf('\n  };', start));
}

describe('EstimateEditorPage — what leaves the app is what is on screen', () => {
  it('flushes and refuses before a PDF', () => {
    expect(body('onPdf')).toContain('await estimateQueueClear()');
  });

  it('flushes and refuses before sharing', () => {
    expect(body('onShare')).toContain('await estimateQueueClear()');
  });

  it('flushes before the client preview too — the server renders that page from what it holds', () => {
    expect(source).toMatch(/useClientPreview\([\s\S]{0,120}estimateQueueClear\)/);
  });

  it('asks about the 0 ₴ lines BEFORE the PDF tab is reserved, so a question never strands a blank tab', () => {
    const pdf = body('onPdf');
    expect(pdf.indexOf('askAboutZeroLines()')).toBeGreaterThan(-1);
    expect(pdf.indexOf('askAboutZeroLines()')).toBeLessThan(pdf.indexOf('reservePdfTab()'));
    expect(body('onShare')).toContain('askAboutZeroLines()');
  });

  it('closes every line-writing sheet when the estimate becomes signed', () => {
    const effect = source.slice(source.indexOf('const signedNow'), source.indexOf('}, [signedNow]);'));
    for (const close of ['setAddOpen(false)', 'setEditing(null)', 'setDictationOpen(false)', 'setReceiptOpen(false)']) {
      expect(effect).toContain(close);
    }
  });
});
